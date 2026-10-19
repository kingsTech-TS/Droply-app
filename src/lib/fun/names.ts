// Playful default device names ("🦦 Sneaky Otter"). Purely cosmetic and editable.

const ADJECTIVES = [
  "Sneaky", "Turbo", "Cosmic", "Sleepy", "Brave", "Fuzzy", "Swift", "Jolly", "Mighty", "Lucky",
  "Zippy", "Clever", "Bouncy", "Chill", "Fancy", "Sunny", "Witty", "Rapid", "Gentle", "Bold",
  "Breezy", "Snappy", "Daring", "Cheery", "Nimble", "Plucky", "Quiet", "Radiant", "Spry", "Zesty",
] as const;

const ANIMALS: ReadonlyArray<readonly [string, string]> = [
  ["🦦", "Otter"], ["🦅", "Falcon"], ["🐼", "Panda"], ["🦊", "Fox"], ["🐙", "Octopus"],
  ["🦉", "Owl"], ["🐢", "Turtle"], ["🦁", "Lion"], ["🐧", "Penguin"], ["🦄", "Unicorn"],
  ["🐨", "Koala"], ["🐬", "Dolphin"], ["🦒", "Giraffe"], ["🐝", "Bee"], ["🦩", "Flamingo"],
  ["🐳", "Whale"], ["🦔", "Hedgehog"], ["🐿️", "Squirrel"], ["🦜", "Parrot"], ["🐆", "Cheetah"],
  ["🦘", "Kangaroo"], ["🐺", "Wolf"], ["🦥", "Sloth"], ["🐞", "Ladybug"], ["🦈", "Shark"],
];

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length) % list.length]!;
}

export function funDeviceName(random: () => number = Math.random): string {
  const [emoji, animal] = pick(ANIMALS, random);
  return `${emoji} ${pick(ADJECTIVES, random)} ${animal}`;
}

const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u;

/** Splits "🦦 Sneaky Otter" into its avatar and the rest of the name. */
export function splitAvatar(name: string): { avatar: string | null; label: string } {
  const match = LEADING_EMOJI.exec(name);
  if (!match) return { avatar: null, label: name };
  return { avatar: match[1] ?? null, label: name.slice(match[0].length) || name };
}
