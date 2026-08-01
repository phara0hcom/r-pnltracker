/**
 * Class-name joiner.
 *
 * CSS-module lookups are `string | undefined` under `noUncheckedIndexedAccess`
 * (a typo in a class name is a real bug worth surfacing), so interpolating them
 * straight into a template literal is unsafe. This drops falsy values and joins
 * the rest.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
