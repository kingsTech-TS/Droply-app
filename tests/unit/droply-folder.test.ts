type DroplyFolderModule = typeof import("@/lib/storage/droply-folder");
type Fs = typeof import("expo-file-system");
type Native = typeof import("../mocks/native");
type Kv = typeof import("@/lib/platform/kv");

/**
 * Loads the module as it would run on `os` (it reads Platform.OS when it loads). Everything
 * comes from the same isolated registry, so the mock file system is shared.
 */
function load(os: "ios" | "android"): { mod: DroplyFolderModule; fs: Fs; kv: Kv; native: Native } {
  let loaded!: { mod: DroplyFolderModule; fs: Fs; kv: Kv; native: Native };
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({ Platform: { OS: os } }));
    loaded = {
      mod: require("@/lib/storage/droply-folder") as DroplyFolderModule,
      fs: require("expo-file-system") as Fs,
      kv: require("@/lib/platform/kv") as Kv,
      native: require("../mocks/native") as Native,
    };
  });
  return loaded;
}

afterEach(() => {
  jest.useRealTimers();
  jest.dontMock("react-native");
});

describe("Droply folder on Android", () => {
  it("waits until the folder is chosen (the Save button stays)", async () => {
    const { mod, kv, native } = load("android");
    const { memFile } = native;
    kv.localKv.removeItem("droply:save-folder");
    expect(mod.refreshDroplyFolder()).toBe("unset");
    const file = memFile("photo.jpg", new Uint8Array([1, 2, 3]));
    expect(await mod.saveToDroplyFolder(file, "photo.jpg", null)).toBe(false);
  });

  it("copies into Download/Droply without overwriting, then drops the app's copy", async () => {
    jest.useFakeTimers();
    const { mod, fs, kv, native } = load("android");
    const { memFile, readMem } = native;
    const download = new fs.Directory("file:///storage/Download");
    download.create();
    const existing = download.createDirectory("Droply").createFile("photo.jpg", "image/jpeg");
    existing.write(new Uint8Array([9]));
    kv.localKv.setItem("droply:save-folder", download.uri);
    expect(mod.refreshDroplyFolder()).toBe("ready");
    expect(mod.droplyFolder.getSnapshot().label).toBe("Download/Droply");

    const file = memFile("photo.jpg", new Uint8Array([1, 2, 3]));
    expect(await mod.saveToDroplyFolder(file, "photo.jpg", "trip/day 1")).toBe(true);
    expect([...readMem("file:///storage/Download/Droply/trip/day 1/photo.jpg")]).toEqual([1, 2, 3]);

    const again = memFile("photo.jpg", new Uint8Array([4]));
    await mod.saveToDroplyFolder(again, "photo.jpg", null);
    expect([...readMem("file:///storage/Download/Droply/photo.jpg")]).toEqual([9]); // untouched
    expect([...readMem("file:///storage/Download/Droply/photo (1).jpg")]).toEqual([4]);

    expect(new fs.File(file.uri).exists).toBe(true);
    jest.advanceTimersByTime(120_000);
    expect(new fs.File(file.uri).exists).toBe(false);
  });
});

describe("Droply folder on iPhone", () => {
  it("counts files already in Documents/Droply as saved (shown in the Files app)", async () => {
    const { mod, native } = load("ios");
    const { memFile } = native;
    expect(mod.refreshDroplyFolder()).toBe("ready");
    const inPlace = { uri: "file:///document/Droply/photo.jpg", name: "photo.jpg", size: 3, type: "image/jpeg", lastModified: 0 };
    expect(await mod.saveToDroplyFolder(inPlace, "photo.jpg", null)).toBe(true);
    const elsewhere = memFile("photo.jpg", new Uint8Array([1]));
    expect(await mod.saveToDroplyFolder(elsewhere, "photo.jpg", null)).toBe(false);
  });
});
