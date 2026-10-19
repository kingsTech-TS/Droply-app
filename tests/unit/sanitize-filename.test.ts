import { dedupeFileName, sanitizeFileName } from "@/lib/utils/sanitize-filename";

describe("sanitizeFileName", () => {
  it("keeps normal names", () => {
    expect(sanitizeFileName("campus-event.mp4")).toBe("campus-event.mp4");
    expect(sanitizeFileName("Résumé 2026.pdf")).toBe("Résumé 2026.pdf");
  });

  it("strips directory components (path traversal)", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Windows\\system32\\evil.dll")).toBe("evil.dll");
  });

  it("removes control characters, bidi overrides and characters illegal on Windows", () => {
    expect(sanitizeFileName("a<b>c:d\"e|f?g*h.txt")).toBe("a_b_c_d_e_f_g_h.txt");
    expect(sanitizeFileName(`invoice${String.fromCharCode(0x202e)}fdp.exe`)).toBe("invoice_fdp.exe");
    expect(sanitizeFileName(`tab${String.fromCharCode(9)}name.txt`)).toBe("tab_name.txt");
  });

  it("avoids reserved Windows names, trailing dots and hidden-file dots", () => {
    expect(sanitizeFileName("CON")).toBe("_CON");
    expect(sanitizeFileName("nul.txt")).toBe("_nul.txt");
    expect(sanitizeFileName("report.pdf...")).toBe("report.pdf");
    expect(sanitizeFileName(".bashrc")).toBe("bashrc");
  });

  it("falls back when nothing is left", () => {
    expect(sanitizeFileName("")).toBe("download");
    expect(sanitizeFileName("...")).toBe("download");
    expect(sanitizeFileName("/")).toBe("download");
  });

  it("limits names to 255 UTF-8 bytes and keeps the extension", () => {
    const name = sanitizeFileName(`${"é".repeat(300)}.mp4`);
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
    expect(name.endsWith(".mp4")).toBe(true);
  });
});

describe("dedupeFileName", () => {
  it("adds a counter before the extension", () => {
    const taken = new Set(["photo.jpg", "photo (1).jpg"]);
    expect(dedupeFileName("photo.jpg", taken)).toBe("photo (2).jpg");
    expect(dedupeFileName("other.jpg", taken)).toBe("other.jpg");
    expect(dedupeFileName("README", new Set(["readme"]))).toBe("README (1)");
  });
});
