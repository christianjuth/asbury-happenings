// Signals the source calendar has nowhere to put, so they ride in the event
// title instead. samanthadress.com word-matched these itself until now; this is
// that check moved server-side so there is exactly one implementation of each
// and the two cannot drift apart. Neither is a guess about the *time* — both
// only read what the title already says.

// Google Calendar makes you pick a start time even when the time is the thing
// that has not been announced, so "TBD" in the title is the only signal that a
// real time exists nowhere yet.
const UNKNOWN_MARKER =
  /\b(?:tbd|tba|to be (?:determined|announced|confirmed))\b/i;
const TIME_NOUN = /\btimes?\b/i;
// Nouns the marker can be attached to instead of the time. "*ADDRESS TBD*" keeps
// its clock; "*TBD TIME & ADDRESS*" does not.
const OTHER_NOUN =
  /\b(?:address(?:es)?|locations?|venues?|line-?ups?|prices?|pricing|tickets?|dates?|openers?|support|details?)\b/i;
// Clause boundaries, so a marker is only read against the nouns it shares a
// phrase with. Deliberately excludes "&" and "and", which join nouns inside one
// phrase rather than separating them.
const PHRASE_BREAK = /[,;|*()[\]\n–—]+/;

// Whole-word so "UNCANCELLED - back on!" is not a cancellation: there is no word
// boundary inside "uncancelled" for `\b` to match.
const CANCELLED_MARKER = /\bcancell?ed\b/i;

// True when the title says the start time has not been announced. Deliberately
// one-sided: reading a real time as unknown costs a hidden clock, while missing
// an unknown one counts a countdown down to a placeholder — so a bare "TBD" with
// no noun attached is treated as being about the time.
export function timeUnknownFromTitle(title: string): boolean {
  const phrases = title.split(PHRASE_BREAK).filter((phrase) => phrase.trim());

  return phrases.some((phrase) => {
    if (!UNKNOWN_MARKER.test(phrase)) {
      return false;
    }

    return TIME_NOUN.test(phrase) || !OTHER_NOUN.test(phrase);
  });
}

// True when the title carries a cancellation the calendar's own STATUS did not.
export function cancelledFromTitle(title: string): boolean {
  return CANCELLED_MARKER.test(title);
}
