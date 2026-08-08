// files.js — getting your work OUT of the browser, and back in.
//
// Kept apart from `store.js` on purpose: everything in there is data and is
// tested in node against a Map, and the moment it touched `document` it would
// stop being. This is the two functions that cannot be tested that way, and
// there is nothing else in here for that reason.
//
// No dependencies, no libraries, and no server: a Blob and an object URL are
// how a page hands somebody a file, and an `<input type=file>` is how it takes
// one. Both are older than this project and neither needs anything installing.

/** Hand the player a file. The anchor is created, clicked and thrown away — it
 *  is never in the document long enough to be seen. */
export function download({ name, type, body }) {
  const blob = new Blob([body], { type: type || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked on the next turn of the loop: revoking it synchronously races the
  // download in some browsers and hands the player an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}

/**
 * Take a file from the player.
 *
 * Resolves with `{ name, text }`, or `null` if they cancelled — and telling
 * those apart matters, because "cancelled" must not be reported as "imported
 * nothing". A cancelled file picker fires no event at all in most browsers, so
 * the promise simply never settles and the caller shows nothing; that is the
 * correct behaviour and the reason there is no timeout here.
 */
export function pickFile(accept = '.txt,.json,text/plain,application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name, text: String(r.result) });
      r.onerror = () => resolve({ name: file.name, text: '', error: 'that file could not be read' });
      r.readAsText(file);
    };
    document.body.append(input);
    input.click();
  });
}
