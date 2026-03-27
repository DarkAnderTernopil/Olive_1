// Top 5 US airlines — used for subject-line matching
const AIRLINE_KEYWORDS = [
  'Delta',
  'United',
  'American Airlines',
  'Southwest',
  'Alaska Airlines',
];

// Pre-compiled regex: case-insensitive, matches any keyword in the subject
const AIRLINE_REGEX = new RegExp(
  AIRLINE_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i',
);

function matchAirline(subject) {
  const match = subject.match(AIRLINE_REGEX);
  return match ? match[0] : null;
}

module.exports = { AIRLINE_KEYWORDS, AIRLINE_REGEX, matchAirline };
