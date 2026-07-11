import _ from "lodash";

interface LocationRewriteRule {
  match: string | string[];
  location: string;
}

export function rewriteLocation(
  location: string | undefined,
  rules: LocationRewriteRule[],
): string | undefined {
  if (!location) {
    return undefined;
  }

  const normalizedLocation = location.toLowerCase();
  const rule = rules.find(({ match }) =>
    _.castArray(match).every((term) =>
      normalizedLocation.includes(term.toLowerCase()),
    ),
  );

  return rule?.location;
}
