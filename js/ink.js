// ink.js — the copper plate, the ink, and the paper.
//
// THE MODEL IS TRANSMITTANCE, NOT COVERAGE, and that choice buys the single most
// important behaviour in the whole renderer for free: CROSS-HATCHING.
//
// If you accumulate "how much of this pixel is covered by a stroke" you have to
// invent a rule for what happens when a second stroke crosses the first, and
// every rule you invent is wrong — add and it goes black at the crossings and
// you get a grid of dark knots; max and two hatch layers are exactly as dark as
// one, so cross-hatching does nothing.
//
// Ink does not work either way.  A layer of ink lets a fraction T of the light
// through; two layers let T₁·T₂ through.  So we store T per pixel, start at 1
// (bare paper), and every stroke MULTIPLIES.  Cross-hatching is then darker than
// single hatching everywhere, and *much* darker at the crossings, and it
// saturates towards black instead of clipping — which is precisely what the
// plates do and precisely why an etcher reaches for a second layer at all.
// This is Beer–Lambert with the exponent folded into the stroke strength.
//
// Everything here works on a plain Float32Array.  There is no canvas in this
// file and there must never be one: the same code has to run in the browser and
// in `node tools/plateshot.mjs`, and produce the same bytes.  See docs — an
// agent that cannot see its own art draws blind.

/* ------------------------------------------------------------- materials -- */

/** Warm ivory laid paper.  Piranesi's impressions are on cream/ivory laid stock,
 *  not white; a white ground makes the ink read as blue-black and kills it. */
export const PAPER = [232, 223, 202];

/** The ink is a warm brown-black, never [0,0,0].  A pure black ink flattens the
 *  darks into a hole in the sheet — the dark of an etching is *layered line*,
 *  and it keeps a colour. */
export const INK = [34, 26, 20];

/** Plate tone: the film of ink the printer leaves on the plate surface outside
 *  the bitten lines.  Tiny, global, and the reason a real impression is never
 *  as bright as its paper. */
export const PLATE_TONE = 0.035;

/* ------------------------------------------------------------- the plate -- */

export class Plate {
  /**
   * @param {number} w  finished width in output pixels
   * @param {number} h  finished height in output pixels
   * @param {number} ss supersample factor.  The ink buffer is w·ss × h·ss and
   *   `develop` boxes it down.  Line art at 1× is harsh and aliased; at ss=2 a
   *   hatch stroke can be a genuine half-pixel wide, which is what the fine
   *   registers need.  Cost is ss² in memory and fill.
   */
  constructor(w, h, ss = 2) {
    this.out = { w, h };
    this.ss = ss;
    this.w = w * ss;
    this.h = h * ss;
    /** Transmittance.  1 = bare paper, 0 = fully inked. */
    this.T = new Float32Array(this.w * this.h).fill(1);
    /** Bookkeeping the instruments read; see tools/plateshot.mjs. */
    this.stats = { strokes: 0, segments: 0, pixels: 0 };
  }

  clear() {
    this.T.fill(1);
    this.stats.strokes = 0;
    this.stats.segments = 0;
    this.stats.pixels = 0;
  }

  /**
   * Lay one segment of ink: a capsule from (x0,y0) radius r0 to (x1,y1) radius
   * r1.  Coordinates are in INK-BUFFER space (already multiplied by ss).
   *
   * `strength` is the opacity of the line at full coverage.  A bitten line is
   * essentially solid, so the default is high; the faint registers get their
   * lightness from being THIN and SPARSE, not from being grey.  Greying a hatch
   * line down is the single most common way to make an etching look like a
   * pencil sketch.
   */
  segment(x0, y0, x1, y1, r0, r1 = r0, strength = 0.92) {
    const W = this.w, H = this.h, T = this.T;
    const rmax = Math.max(r0, r1) + 0.75;

    let lo = Math.max(0, Math.floor(Math.min(x0, x1) - rmax));
    let hi = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + rmax));
    let to = Math.max(0, Math.floor(Math.min(y0, y1) - rmax));
    let bo = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + rmax));
    if (lo > hi || to > bo) return;

    const dx = x1 - x0, dy = y1 - y0;
    const dd = dx * dx + dy * dy;
    const inv = dd > 1e-9 ? 1 / dd : 0;
    const dr = r1 - r0;

    for (let y = to; y <= bo; y++) {
      const row = y * W;
      const py = y + 0.5 - y0;
      for (let x = lo; x <= hi; x++) {
        const px = x + 0.5 - x0;
        let t = (px * dx + py * dy) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - dx * t, ey = py - dy * t;
        const d = Math.sqrt(ex * ex + ey * ey);
        // Coverage of a disc of radius r(t) over this pixel, approximated by a
        // one-pixel-wide ramp.  Cheap, and at ss≥2 indistinguishable from an
        // analytic area.
        const cov = (r0 + dr * t) + 0.5 - d;
        if (cov <= 0) continue;
        const a = (cov >= 1 ? 1 : cov) * strength;
        const i = row + x;
        T[i] *= 1 - a;
        this.stats.pixels++;
      }
    }
    this.stats.segments++;
  }

  /**
   * A stroke is a polyline with a width profile.  Real etched lines are not
   * uniform: the needle enters and leaves the ground, so a stroke is thin at
   * both ends and fullest in the middle, and that taper is most of what makes
   * hatching read as drawn rather than as a screen-door texture.
   *
   * `pts` is a flat [x0,y0, x1,y1, …] in ink-buffer space.
   * `width` is the full width at the stroke's fattest point.
   * `taper` in [0,1]: 0 = a uniform bar, 1 = a needle at both ends.
   */
  stroke(pts, width, strength = 0.92, taper = 0.55) {
    const n = pts.length >> 1;
    if (n < 2) return;
    const rMax = width / 2;
    const rEnd = rMax * (1 - taper);

    // Arc-length parameterisation, so the taper follows the drawn line and not
    // the vertex count — a curve tessellated into 40 pieces and the same curve
    // in 4 must taper identically.
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    }
    const L = cum[n - 1] || 1;
    const radiusAt = (s) => {
      const t = s / L;                       // 0..1 along the stroke
      const e = Math.min(t, 1 - t) * 2;      // 0 at the ends, 1 at the middle
      // sqrt is the profile that reaches full width quickly and only pinches
      // right at the tips; a linear ramp makes every stroke look like a dart.
      return rEnd + (rMax - rEnd) * Math.sqrt(e);
    };

    for (let i = 0; i < n - 1; i++) {
      this.segment(
        pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3],
        radiusAt(cum[i]), radiusAt(cum[i + 1]), strength,
      );
    }
    this.stats.strokes++;
  }

  /* ------------------------------------------------------------- reading -- */

  /** Mean ink (1−T) over the whole sheet.  The instruments' headline number:
   *  a Carceri plate is a DARK object, and if this reads 0.08 the renderer has
   *  drawn a technical illustration, not an engraving. */
  meanInk() {
    const T = this.T;
    let s = 0;
    for (let i = 0; i < T.length; i++) s += T[i];
    return 1 - s / T.length;
  }

  /** Histogram of developed luminance, `bins` buckets.  This is how we check the
   *  VALUE STRUCTURE — Piranesi's plates are bimodal (bare paper and near-solid
   *  black, little mid-grey), and a renderer that produces a nice fat normal
   *  distribution in the middle has failed even if every stroke is correct. */
  histogram(bins = 16) {
    const out = new Float64Array(bins);
    const T = this.T;
    for (let i = 0; i < T.length; i++) {
      let b = (T[i] * bins) | 0;
      if (b >= bins) b = bins - 1;
      if (b < 0) b = 0;
      out[b]++;
    }
    for (let i = 0; i < bins; i++) out[i] /= T.length;
    return Array.from(out);
  }

  /* ------------------------------------------------------------- printing -- */

  /**
   * Pull an impression: transmittance → RGBA, boxing down the supersample.
   *
   *   observed = paper·T + ink·(1−T)
   *
   * @param {object} opts
   *   grain      0..1 strength of the laid-paper texture
   *   plateTone  overall film of ink left on the plate
   *   margin     px of bare paper around the image, in OUTPUT pixels; the plate
   *              mark is drawn just inside it
   */
  develop(opts = {}) {
    const { w, h } = this.out;
    const ss = this.ss, T = this.T, W = this.w;
    const grain = opts.grain ?? 1;
    const tone = opts.plateTone ?? PLATE_TONE;
    const paper = opts.paper || PAPER;
    const ink = opts.ink || INK;
    const px = new Uint8ClampedArray(w * h * 4);
    const inv = 1 / (ss * ss);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        const y0 = y * ss, x0 = x * ss;
        for (let sy = 0; sy < ss; sy++) {
          const row = (y0 + sy) * W + x0;
          for (let sx = 0; sx < ss; sx++) acc += T[row + sx];
        }
        let t = acc * inv * (1 - tone);

        // Laid paper.  Two frequencies, because that is what laid paper is: the
        // fine LAID lines from the mould's close-set wires, and the CHAIN lines
        // every 25mm or so where the wires are sewn to the ribs.  Both are
        // brightness variations in the sheet, so they modulate the paper, never
        // the ink.
        let p = 1;
        if (grain > 0) {
          const laid = Math.sin(y * 0.9) * 0.006 + Math.sin(y * 2.7 + 1.3) * 0.003;
          const chain = Math.sin(x * 0.045) > 0.985 ? 0.018 : 0;
          const fibre = ((x * 92837111) ^ (y * 689287499)) & 255;
          p = 1 + (laid + chain + (fibre / 255 - 0.5) * 0.014) * grain;
        }

        const i = (y * w + x) * 4;
        px[i] = paper[0] * p * t + ink[0] * (1 - t);
        px[i + 1] = paper[1] * p * t + ink[1] * (1 - t);
        px[i + 2] = paper[2] * p * t + ink[2] * (1 - t);
        px[i + 3] = 255;
      }
    }
    return { data: px, width: w, height: h };
  }
}
