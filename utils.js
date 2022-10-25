import crypto from "crypto";

// https://en.wikipedia.org/wiki/Fisher–Yates_shuffle
export function shuffle(arr, i = 1) {
  if (i < 1) {
    throw new Error(`${i} is not a valid parameter, should be more or equal 1`);
  }
  const length = arr == null ? 0 : arr.length;
  if (!length) {
    return [];
  }
  let result = arr;
  times(i, () => {
    let index = -1;
    while (++index < length) {
      const rand = crypto.randomInt(length);
      const value = result[rand];
      result[rand] = result[index];
      result[index] = value;
    }
  });
  return result;
}

export function times(n, fn) {
  for (let i = 0; i < n; i++) {
    fn();
  }
}
