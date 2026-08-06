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
/* The palette itself lives in palette.js — this file owns the ink MODEL and the
 * printing, not the colours.  Kept re-exported so nothing has to know where the
 * swatches moved to. */

export { PAPER, INK_WARM, INK_COOL, PLATE_TONE } from './palette.js';
import { PAPER, INK_WARM, INK_COOL, PLATE_TONE, THIN_WARMTH, inkAt } from './palette.js';

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
    /** Transmittance of the LINE WORK.  1 = bare paper, 0 = fully inked. */
    this.T = new Float32Array(this.w * this.h).fill(1);
    /**
     * Transmittance of the FLAT TONE — the printed area under the drawing.
     *
     * A second buffer, and at OUTPUT resolution rather than the supersampled
     * one, because the two are different kinds of mark.  A stroke is a thin
     * thing whose quality lives in its antialiasing, so it needs the
     * supersample; a printed ground is a broad area whose edges are covered by
     * the outline drawn over them, so it does not, and giving it one would cost
     * four times the texture evaluations for nothing visible.
     *
     * They combine by multiplying, like everything else here: a line over a
     * grey ground is darker than either.  See `develop`.
     */
    this.fill = new Float32Array(w * h).fill(1);
    /** Bookkeeping the instruments read; see tools/plateshot.mjs. */
    this.stats = { strokes: 0, segments: 0, pixels: 0, filled: 0 };
  }

  clear() {
    this.T.fill(1);
    this.fill.fill(1);
    this.stats.strokes = 0;
    this.stats.segments = 0;
    this.stats.pixels = 0;
    this.stats.filled = 0;
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
    const T = this.T, F = this.fill, ss = this.ss, W = this.w;
    let s = 0;
    for (let y = 0; y < this.out.h; y++) {
      for (let x = 0; x < this.out.w; x++) {
        let a = 0;
        for (let sy = 0; sy < ss; sy++) {
          const row = (y * ss + sy) * W + x * ss;
          for (let sx = 0; sx < ss; sx++) a += T[row + sx];
        }
        s += (a / (ss * ss)) * F[y * this.out.w + x];
      }
    }
    return 1 - s / (this.out.w * this.out.h);
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
   *   observed = ground·T + ink(warmth)·(1−T)
   *
   * THE INK COLOUR IS PER PIXEL, and that is the only interesting thing here.
   * A single flat ink gives you a monochrome drawing; two near-blacks chosen
   * one warm and one cool, mixed by how the surface under the pixel is lit,
   * give you a muted neutral palette that separates a sky-lit floor from a
   * bounce-lit vault without ever reaching for a colour.  See palette.js.
   *
   * @param {object} opts
   *   warmth     Float32Array, one value per OUTPUT pixel in [−1,+1]; −1 cool,
   *              +1 warm.  Omit and the whole sheet takes the neutral middle.
   *   grain      0..1 strength of the paper texture
   *   plateTone  overall film of ink left on the ground
   */
  develop(opts = {}) {
    const { w, h } = this.out;
    const ss = this.ss, T = this.T, W = this.w;
    const grain = opts.grain ?? 1;
    const tone = opts.plateTone ?? PLATE_TONE;
    const paper = opts.paper || PAPER;
    const warmth = opts.warmth || null;
    const px = new Uint8ClampedArray(w * h * 4);
    const inv = 1 / (ss * ss);
    const ink = [0, 0, 0];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        const y0 = y * ss, x0 = x * ss;
        for (let sy = 0; sy < ss; sy++) {
          const row = (y0 + sy) * W + x0;
          for (let sx = 0; sx < ss; sx++) acc += T[row + sx];
        }
        const o = y * w + x;
        // Line work × printed ground.  Both are transmittances, so this is the
        // same Beer–Lambert multiply that makes cross-hatching work.
        const t = acc * inv * this.fill[o] * (1 - tone);

        // Paper texture, two frequencies, and it modulates the GROUND only —
        // never the ink.  A texture that also dirties the ink reads as a filter
        // over the picture instead of a surface under it.
        let p = 1;
        if (grain > 0) {
          const broad = Math.sin(y * 0.9) * 0.004 + Math.sin(x * 0.7 + 1.3) * 0.003;
          const fibre = ((x * 92837111) ^ (y * 689287499)) & 255;
          p = 1 + (broad + (fibre / 255 - 0.5) * 0.011) * grain;
        }

        const d = 1 - t;
        inkAt(warmth ? warmth[o] : 0, ink);
        // Ink warms as the film thins.  True of any printed ink, and it is the
        // difference between a palette that reads as printed and one that reads
        // as filled with a colour picker.
        const thin = THIN_WARMTH * (1 - d);
        const i = o * 4;
        px[i] = paper[0] * p * t + (ink[0] + thin) * d;
        px[i + 1] = paper[1] * p * t + ink[1] * d;
        px[i + 2] = paper[2] * p * t + (ink[2] - thin * 0.6) * d;
        px[i + 3] = 255;
      }
    }
    return { data: px, width: w, height: h };
  }
}
