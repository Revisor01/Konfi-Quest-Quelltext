// Muss mit dem Backend übereinstimmen (commonValidations.username in
// backend/middleware/validation.js): 3-50 Zeichen, nur Buchstaben, Zahlen,
// Punkt und Bindestrich — keine Leerzeichen, Umlaute oder Unterstriche.
export const USERNAME_REGEX = /^[a-zA-Z0-9.-]+$/;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;

export const USERNAME_RULES_MESSAGE =
  'Nur Buchstaben, Zahlen, Punkt (.) und Bindestrich (-) — keine Leerzeichen oder Umlaute';

export function hasValidUsernameChars(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

export function isValidUsername(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    hasValidUsernameChars(username)
  );
}
