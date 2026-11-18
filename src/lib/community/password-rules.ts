/*
 * What makes a new password acceptable, shared by the server (which decides) and the sign-up
 * form (which says so while it's typed). NIST SP 800-63B rev. 4: length is what counts, at
 * least 15 characters; no "one digit, one symbol" rules; refuse what's known to be guessed first
 * and what's made of the person's or the site's own names. The breach check is on the server.
 */

export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;

/** Characters as people count them (an emoji is one). */
export const passwordLength = (pw: string) => [...pw].length;

// The words at the heart of the passwords tried first in every attack (from the published
// lists of the most common passwords), and the ones people pick for a site like this one.
// A password that's only one of these, repeated or with digits and symbols round it, is refused.
const COMMON_CORES = new Set([
  "password", "passwort", "passw0rd", "pass", "qwerty", "qwertz", "azerty", "asdf", "asdfgh", "zxcvbn", "iloveyou", "letmein",
  "welcome", "admin", "administrator", "login", "master", "monkey", "dragon", "shadow", "sunshine", "princess", "football",
  "baseball", "soccer", "superman", "batman", "trustno", "whatever", "freedom", "hello", "secret", "starwars", "pokemon",
  "computer", "internet", "changeme", "default", "abc", "test", "guest", "user", "love", "lovely", "summer", "winter",
  "senha", "palavrapasse", "contrasena", "contraseña", "motdepasse", "passwortpasswort", "benfica", "sporting", "porto",
  "fcporto", "lisboa", "portugal", "brasil", "brazil", "flamengo", "corinthians", "barcelona", "madrid", "realmadrid",
  "liverpool", "arsenal", "chelsea", "juventus", "mundivi", "omnievent", "concerto", "concert", "festival", "tickets",
  "bilhetes", "events", "eventos",
]);

// Rows and runs on a keyboard and in the alphabet, both ways round.
const RUNS = [
  "abcdefghijklmnopqrstuvwxyz",
  "01234567890123456789",
  "qwertyuiopasdfghjklzxcvbnm",
  "qwertzuiopasdfghjklyxcvbnm",
  "azertyuiopqsdfghjklmwxcvbn",
  "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p",
  "zaq1xsw2cde3vfr4bgt5nhy6mju7ki8lo9p0",
  "1q2w3e4r5t6y7u8i9o0p",
  "qazwsxedcrfvtgbyhnujmikolp",
];

const LEET: Record<string, string> = { "@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t", "+": "t" };
/** Look-alike characters inside a word back to letters: "p@ssw0rd" → "password" (not "pass 2026"). */
function deLeet(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const swap = LEET[s[i]];
    out += swap && /[a-z]/.test(s[i - 1] ?? "") && /[a-z@$0-9]/.test(s[i + 1] ?? "") ? swap : s[i];
  }
  return out;
}

/** What's wrong with a new password, in plain words, or null when it's fine. */
export function passwordProblem(pw: string, who: { username?: string; email?: string } = {}): string | null {
  const n = passwordLength(pw);
  if (n < PASSWORD_MIN)
    return `Use at least ${PASSWORD_MIN} characters (${PASSWORD_MIN - n} more). A few words together is easiest to remember, like “sardines at midnight in Porto”.`;
  if (n > PASSWORD_MAX) return `That password is too long: ${PASSWORD_MAX} characters at most.`;
  const low = pw.toLowerCase();
  const easy = "That password is too easy to guess. Try a few words together, like a short sentence only you would write.";
  // Very few different characters ("aaaaaaaaaaaaaaa", "abababababababab").
  if (new Set(low).size <= 3) return easy;
  // One short piece over and over ("passwordpassword", "abc123abc123abc123"), maybe with a little on the end.
  if (/^([\s\S]{1,8}?)\1{2,}[\s\S]{0,3}$/.test(low) || /^([\s\S]{4,12}?)\1+[\s\S]{0,3}$/.test(low)) return easy;
  // Letters and digits only, in a row on the keyboard or in the alphabet ("123456789012345", "qwertyuiopasdfg").
  const plain = low.replace(/[^a-z0-9]/g, "");
  if (plain.length >= 8 && plain.length >= n - 3 && RUNS.some((r) => r.includes(plain) || [...r].reverse().join("").includes(plain))) return easy;
  // A common password at heart: undo look-alike swaps ("p@ssw0rd"), take away digits, symbols
  // and spaces, and repeats.
  for (const form of [low, deLeet(low)]) {
    const core = form.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
    const unit = core.match(/^(.+?)\1*$/)?.[1] ?? core;
    if (COMMON_CORES.has(core) || COMMON_CORES.has(unit)) return easy;
  }
  // The person's or the site's own names.
  const local = who.email?.split("@")[0]?.toLowerCase();
  const user = who.username?.toLowerCase();
  if ((user && user.length >= 4 && low.includes(user)) || (local && local.length >= 4 && low.includes(local))) return "Don't use your username or email in the password.";
  if (/mundivi|omnievent/.test(deLeet(low).replace(/[^a-z]/g, ""))) return "Don't use the site's name in the password.";
  return null;
}

/** For the form, while typing: how far there is still to go, or null when long enough. */
export function passwordProgress(pw: string): { left: number } | null {
  const left = PASSWORD_MIN - passwordLength(pw);
  return left > 0 ? { left } : null;
}
