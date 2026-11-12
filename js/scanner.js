// Live-Scanner: Kamera im Rahmen, automatische Aufnahme sobald das Bild ruhig ist,
// Texterkennung direkt auf dem Gerät (Tesseract.js). Es wird kein Foto gespeichert.

const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let workerPromise = null;

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error("Texterkennung konnte nicht geladen werden. Internet prüfen."));
    document.head.append(s);
  });
}

/** Lädt die Texterkennung einmalig (Sprachdaten ca. 10 MB, danach offline im Gerät gespeichert). */
export function warmUp(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT);
      const w = await window.Tesseract.createWorker("deu", 1, {
        logger: m => { if (onProgress && m && typeof m.progress === "number") onProgress(m.status, m.progress); }
      });
      await w.setParameters({ tessedit_pageseg_mode: "4", preserve_interword_spaces: "1" });
      return w;
    })().catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Graustufen, vergrößern, lokaler Schwellwert: macht Thermodruck für die Erkennung kontrastreich. */
export function preprocess(src) {
  const sw = src.width, sh = src.height;
  const k = Math.min(3, Math.max(1, 1400 / sw));
  const W = Math.round(sw * k), H = Math.round(sh * k);
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  // Integralbild für schnellen lokalen Mittelwert
  const S = new Float64Array((W + 1) * (H + 1));
  for (let y = 1; y <= H; y++) {
    let row = 0;
    for (let x = 1; x <= W; x++) { row += gray[(y - 1) * W + (x - 1)]; S[y * (W + 1) + x] = S[(y - 1) * (W + 1) + x] + row; }
  }
  const r = Math.max(8, Math.round(W / 24));
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const sum = S[y1 * (W + 1) + x1] - S[y0 * (W + 1) + x1] - S[y1 * (W + 1) + x0] + S[y0 * (W + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const v = gray[y * W + x] < mean * 0.86 ? 0 : 255;
      const p = (y * W + x) * 4; d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export async function recognize(canvas, onProgress) {
  const w = await warmUp(onProgress);
  const { data } = await w.recognize(preprocess(canvas));
  return data.text || "";
}

/**
 * Öffnet den Vollbild-Scanner. Resolves mit einem Canvas des Bons (nur im Speicher) oder null bei Abbruch.
 * opts.title: Text oben, z. B. "Teil 2: unterer Bereich".
 */
export function scan(opts = {}) {
  const root = document.getElementById("scanner");
  const video = root.querySelector("video");
  const frame = root.querySelector(".frame");
  const hint = root.querySelector(".sc-hint");
  const meter = root.querySelector(".sc-meter i");
  const shutter = root.querySelector(".sc-shutter");
  const closeBtn = root.querySelector(".sc-close");
  const pick = root.querySelector("#sc-file");
  root.querySelector(".sc-title").textContent = opts.title || "Bon in den Rahmen halten";

  return new Promise(resolve => {
    let stream = null, raf = 0, last = null, stable = 0, done = false, lastT = 0, startT = performance.now();
    const probe = document.createElement("canvas"); probe.width = 96; probe.height = 192;
    const pg = probe.getContext("2d", { willReadFrequently: true });

    const finish = result => {
      if (done) return; done = true;
      cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
      root.hidden = true; document.body.classList.remove("noscroll");
      shutter.onclick = closeBtn.onclick = pick.onchange = null;
      resolve(result);
    };

    // Rahmen (Bildschirmkoordinaten) → Videopixel, Video wird mit object-fit: cover angezeigt
    const cropRect = () => {
      const vr = video.getBoundingClientRect(), fr = frame.getBoundingClientRect();
      const iw = video.videoWidth, ih = video.videoHeight;
      const s = Math.max(vr.width / iw, vr.height / ih);
      const ox = vr.left + (vr.width - iw * s) / 2, oy = vr.top + (vr.height - ih * s) / 2;
      const x = Math.max(0, (fr.left - ox) / s), y = Math.max(0, (fr.top - oy) / s);
      return { x, y, w: Math.min(iw - x, fr.width / s), h: Math.min(ih - y, fr.height / s) };
    };
    const capture = () => {
      if (!video.videoWidth) return;
      const r = cropRect();
      const c = document.createElement("canvas"); c.width = Math.round(r.w); c.height = Math.round(r.h);
      c.getContext("2d").drawImage(video, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
      if (navigator.vibrate) navigator.vibrate(30);
      finish(c);
    };

    // Ruhe- und Schärfemessung auf einem kleinen Vorschaubild
    const tick = t => {
      raf = requestAnimationFrame(tick);
      if (t - lastT < 220 || !video.videoWidth) return;
      lastT = t;
      const r = cropRect();
      pg.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, probe.width, probe.height);
      const d = pg.getImageData(0, 0, probe.width, probe.height).data;
      const n = probe.width * probe.height, gray = new Uint8ClampedArray(n);
      let bright = 0;
      for (let i = 0, p = 0; i < n; i++, p += 4) { gray[i] = (d[p] * 3 + d[p + 1] * 6 + d[p + 2]) / 10; bright += gray[i]; }
      bright /= n;
      let sharp = 0, diff = 0;
      for (let y = 1; y < probe.height - 1; y++) for (let x = 1; x < probe.width - 1; x++) {
        const i = y * probe.width + x;
        sharp += Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - probe.width] - gray[i + probe.width]);
      }
      sharp /= n;
      if (last) { for (let i = 0; i < n; i++) diff += Math.abs(gray[i] - last[i]); diff /= n; }
      last = gray;
      const ok = sharp > 9 && diff < 4 && bright > 70;
      stable = ok ? stable + 1 : 0;
      meter.style.width = Math.min(100, stable / 5 * 100) + "%";
      if (bright <= 70) hint.textContent = "Zu dunkel – mehr Licht";
      else if (sharp <= 9) hint.textContent = "Unscharf – etwas weiter weg halten";
      else if (diff >= 4) hint.textContent = "Ruhig halten …";
      else hint.textContent = "Gleich geht's los";
      if (stable >= 5 && t - startT > 1200) capture();
    };

    shutter.onclick = capture;
    closeBtn.onclick = () => finish(null);
    pick.onchange = async () => {
      const f = pick.files && pick.files[0]; pick.value = "";
      if (!f) return;
      try {
        const bmp = await createImageBitmap(f);
        const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
        c.getContext("2d").drawImage(bmp, 0, 0); bmp.close && bmp.close();
        finish(c);
      } catch { hint.textContent = "Bild konnte nicht geöffnet werden."; }
    };

    root.hidden = false; document.body.classList.add("noscroll");
    meter.style.width = "0%";
    hint.textContent = "Kamera wird gestartet …";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      hint.textContent = "Kamera hier nicht verfügbar. Nutze „Bild wählen“."; return;
    }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } })
      .then(s => {
        if (done) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s; video.srcObject = s;
        return video.play().then(() => { startT = performance.now(); raf = requestAnimationFrame(tick); });
      })
      .catch(e => {
        hint.textContent = e && e.name === "NotAllowedError"
          ? "Kamerazugriff verweigert. Erlauben unter Einstellungen → Safari → Kamera."
          : "Kamera konnte nicht gestartet werden. Nutze „Bild wählen“.";
      });
  });
}
