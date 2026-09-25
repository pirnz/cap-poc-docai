/**
 * Parser for Groovy/Java object notation to JSON
 * Handles format like: {key=value, nested={inner=123}, array=[1,2,3]}
 */

function parseGroovyToJson(str) {
  if (!str || typeof str !== 'string') {
    return null;
  }

  let pos = 0;
  const length = str.length;

  function skipWhitespace() {
    while (pos < length && /\s/.test(str[pos])) {
      pos++;
    }
  }

  function parseValue() {
    skipWhitespace();

    if (pos >= length) {
      return null;
    }

    const char = str[pos];

    // Object
    if (char === '{') {
      return parseObject();
    }

    // Array
    if (char === '[') {
      return parseArray();
    }

    // String (quoted)
    if (char === '"' || char === "'") {
      return parseString();
    }

    // Number, boolean, null, or unquoted string
    return parsePrimitive();
  }

  function parseObject() {
    const obj = {};
    pos++; // skip '{'
    skipWhitespace();

    while (pos < length && str[pos] !== '}') {
      skipWhitespace();

      if (str[pos] === '}') break;

      // Parse key
      const key = parseKey();
      if (!key) {
        throw new Error(`Expected key at position ${pos}, found '${str[pos]}'`);
      }

      skipWhitespace();

      // Expect '='
      if (str[pos] !== '=') {
        throw new Error(`Expected '=' at position ${pos}, found '${str[pos]}'`);
      }
      pos++; // skip '='

      skipWhitespace();

      // Parse value
      const value = parseValue();
      obj[key] = value;

      skipWhitespace();

      // Handle comma or end of object
      if (str[pos] === ',') {
        pos++; // skip ','
      } else if (str[pos] === '}') {
        break;
      }
    }

    if (str[pos] === '}') {
      pos++; // skip '}'
    }

    return obj;
  }

  function parseArray() {
    const arr = [];
    pos++; // skip '['
    skipWhitespace();

    while (pos < length && str[pos] !== ']') {
      skipWhitespace();

      const value = parseValue();
      arr.push(value);

      skipWhitespace();

      if (str[pos] === ',') {
        pos++; // skip ','
      } else if (str[pos] === ']') {
        break;
      }
    }

    if (str[pos] === ']') {
      pos++; // skip ']'
    }

    return arr;
  }

  function parseKey() {
    skipWhitespace();
    let key = '';

    // Keys can be quoted or unquoted
    if (str[pos] === '"' || str[pos] === "'") {
      return parseString();
    }

    // Unquoted key - must be followed by '='
    const startPos = pos;
    while (pos < length && /[a-zA-Z0-9_]/.test(str[pos])) {
      key += str[pos];
      pos++;
    }

    // Verify this is actually a key (followed by '=' after optional whitespace)
    const savedPos = pos;
    skipWhitespace();
    if (str[pos] !== '=') {
      // Not a key, restore position
      pos = startPos;
      return null;
    }
    // Restore position to just after key (before whitespace)
    pos = savedPos;

    return key;
  }

  function parseString() {
    const quote = str[pos];
    pos++; // skip opening quote

    let value = '';
    let escaped = false;

    while (pos < length) {
      const char = str[pos];

      if (escaped) {
        // Handle escape sequences
        switch (char) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          default: value += char;
        }
        escaped = false;
        pos++;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        pos++;
        continue;
      }

      if (char === quote) {
        pos++; // skip closing quote
        break;
      }

      value += char;
      pos++;
    }

    return value;
  }

  function parsePrimitive() {
    let value = '';
    let bracketDepth = 0; // Track nested brackets in unquoted strings

    // Read until we find a definitive delimiter
    while (pos < length) {
      const char = str[pos];

      // Track bracket depth - brackets can be part of unquoted string values
      if (char === '[') {
        bracketDepth++;
        value += char;
        pos++;
        continue;
      }

      if (char === ']') {
        if (bracketDepth > 0) {
          // This is a closing bracket within the value
          bracketDepth--;
          value += char;
          pos++;
          continue;
        } else {
          // This is a structural end character
          break;
        }
      }

      // Check if this is a structural end character (only when not inside brackets)
      if (bracketDepth === 0 && char === '}') {
        break;
      }

      // For comma, we need to check if it's followed by a key or just part of the value
      if (char === ',') {
        // Look ahead past the comma and whitespace
        let lookAhead = pos + 1;

        // Skip whitespace after comma
        while (lookAhead < length && /\s/.test(str[lookAhead])) {
          lookAhead++;
        }

        // Check if what follows looks like a key (word followed by =)
        if (lookAhead < length) {
          const nextChar = str[lookAhead];

          // If it's a structural character, comma is a separator (only if not in brackets)
          if (bracketDepth === 0 && (nextChar === '}' || nextChar === ']')) {
            break;
          }

          // If it starts with a letter/underscore, check if it's a key
          if (/[a-zA-Z_]/.test(nextChar)) {
            let keyCheck = lookAhead;
            let potentialKey = '';

            // Gather potential key characters
            while (keyCheck < length && /[a-zA-Z0-9_]/.test(str[keyCheck])) {
              potentialKey += str[keyCheck];
              keyCheck++;
            }

            // Skip whitespace after potential key
            while (keyCheck < length && /\s/.test(str[keyCheck])) {
              keyCheck++;
            }

            // If followed by '=', this comma is a separator (only if not in brackets)
            if (bracketDepth === 0 && keyCheck < length && str[keyCheck] === '=') {
              break;
            }
          }
        }

        // Otherwise, comma is part of the value
        value += char;
        pos++;
        continue;
      }

      value += char;
      pos++;
    }

    value = value.trim();

    // Empty value
    if (value === '' || value === 'null') {
      return null;
    }

    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Number (including scientific notation)
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
      return parseFloat(value);
    }

    // Unquoted string
    return value;
  }

  try {
    skipWhitespace();
    const result = parseValue();
    return result;
  } catch (error) {
    console.error('[ERROR] Groovy parser failed:', error.message);
    console.error(`[ERROR] Failed at position ${pos}: "${str.substring(Math.max(0, pos - 50), pos + 50)}"`);
    throw error;
  }
}

module.exports = {
  parseGroovyToJson
};
