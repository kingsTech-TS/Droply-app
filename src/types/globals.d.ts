// Globals that exist at runtime in React Native (Hermes). The DOM lib is deliberately not
// loaded (tsconfig `lib: ["ES2023"]`), so any browser-only API used by mistake fails the
// typecheck instead of crashing on a phone.
/// <reference path="../../node_modules/react-native/src/types/globals.d.ts" />

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare const performance: { now(): number };

declare function btoa(data: string): string;
declare function atob(data: string): string;

declare const process: {
  env: Record<string, string | undefined> & { NODE_ENV?: string };
};
