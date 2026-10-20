/**
 * Word bank for Quick Match.
 *
 * PLACEHOLDER LIST: swap this for the same word source the Solo mode (P5) uses,
 * so both modes feel the same. Only `pickWords` is used by the room.
 */
const WORD_BANK = [
  "about", "above", "across", "after", "again", "air", "all", "almost", "along", "also",
  "always", "animal", "answer", "around", "away", "back", "because", "become", "before", "begin",
  "being", "below", "between", "bird", "black", "blue", "body", "book", "both", "boy",
  "bring", "build", "call", "carry", "change", "children", "city", "close", "color", "come",
  "could", "country", "cut", "day", "different", "does", "door", "down", "draw", "each",
  "earth", "eat", "end", "enough", "even", "every", "example", "eye", "face", "family",
  "far", "father", "feet", "few", "find", "first", "follow", "food", "form", "found",
  "friend", "from", "game", "gave", "girl", "give", "good", "great", "green", "grow",
  "hand", "hard", "head", "hear", "help", "high", "home", "house", "idea", "important",
  "keep", "kind", "know", "land", "large", "last", "late", "learn", "leave", "left",
  "letter", "life", "light", "line", "little", "live", "long", "look", "made", "make",
  "many", "might", "mile", "mother", "mountain", "move", "much", "music", "name", "near",
  "never", "new", "next", "night", "number", "often", "once", "only", "open", "other",
  "page", "paper", "part", "people", "picture", "place", "plant", "play", "point", "problem",
  "quick", "read", "real", "river", "run", "same", "school", "sea", "second", "seem",
  "sentence", "should", "show", "side", "small", "something", "sometimes", "song", "sound", "spell",
  "start", "state", "still", "stop", "story", "study", "such", "sun", "take", "tell",
  "thing", "think", "thought", "three", "through", "time", "together", "tree", "try", "turn",
  "under", "until", "upon", "use", "very", "walk", "want", "watch", "water", "way",
  "week", "were", "what", "where", "while", "white", "whole", "without", "word", "work",
  "world", "would", "write", "year", "young",
];

/**
 * Returns `count` random words. The same array is sent to both players,
 * so the race is fair. Never picks the same word twice in a row.
 */
export function pickWords(count: number): string[] {
  const words: string[] = [];
  while (words.length < count) {
    const word = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
    if (word !== words[words.length - 1]) {
      words.push(word);
    }
  }
  return words;
}
