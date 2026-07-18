#include "philcoino/api_json.hpp"

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <utility>

namespace philcoino::networking::json {

ObjectParser::ObjectParser(const std::string& input) : input_(input) {}

bool ObjectParser::parse(std::vector<Field>& fields) {
  if (input_.size() > kMaximumInputBytes) {
    return false;
  }
  std::vector<Field> parsed_fields;
  skip_whitespace();
  if (!take('{')) {
    return false;
  }
  skip_whitespace();
  if (take('}')) {
    skip_whitespace();
    if (!at_end()) {
      return false;
    }
    fields = std::move(parsed_fields);
    return true;
  }
  while (true) {
    Field field;
    if (!parse_string(field.key)) {
      return false;
    }
    for (const auto& existing : parsed_fields) {
      if (existing.key == field.key) {
        return false;
      }
    }
    skip_whitespace();
    if (!take(':')) {
      return false;
    }
    skip_whitespace();
    if (!parse_value(field.value)) {
      return false;
    }
    parsed_fields.push_back(std::move(field));
    skip_whitespace();
    if (take('}')) {
      skip_whitespace();
      if (!at_end()) {
        return false;
      }
      fields = std::move(parsed_fields);
      return true;
    }
    if (!take(',')) {
      return false;
    }
    skip_whitespace();
  }
}

bool ObjectParser::parse_value(Value& value) {
  if (current() == '"') {
    value.type = Value::Type::kString;
    return parse_string(value.string);
  }
  if (current() == '-' || (current() >= '0' && current() <= '9')) {
    value.type = Value::Type::kNumber;
    return parse_number(value.number);
  }
  if (consume_literal("true")) {
    value.type = Value::Type::kBoolean;
    value.boolean = true;
    return true;
  }
  if (consume_literal("false")) {
    value.type = Value::Type::kBoolean;
    value.boolean = false;
    return true;
  }
  value.type = Value::Type::kOther;
  const std::size_t start = position_;
  if (consume_literal("null") || consume_composite()) {
    value.string = input_.substr(start, position_ - start);
    return true;
  }
  return false;
}

bool ObjectParser::parse_string(std::string& output) {
  if (!take('"')) {
    return false;
  }
  while (!at_end()) {
    const char character = input_[position_++];
    if (character == '"') {
      return true;
    }
    if (static_cast<unsigned char>(character) < 0x20U) {
      return false;
    }
    if (character != '\\') {
      output.push_back(character);
      continue;
    }
    if (at_end()) {
      return false;
    }
    const char escaped = input_[position_++];
    switch (escaped) {
      case '"': output.push_back('"'); break;
      case '\\': output.push_back('\\'); break;
      case '/': output.push_back('/'); break;
      case 'b': output.push_back('\b'); break;
      case 'f': output.push_back('\f'); break;
      case 'n': output.push_back('\n'); break;
      case 'r': output.push_back('\r'); break;
      case 't': output.push_back('\t'); break;
      case 'u':
        if (!parse_ascii_unicode(output)) {
          return false;
        }
        break;
      default: return false;
    }
  }
  return false;
}

bool ObjectParser::parse_ascii_unicode(std::string& output) {
  if (position_ + 4 > input_.size()) {
    return false;
  }
  unsigned value = 0;
  for (int index = 0; index < 4; ++index) {
    const char digit = input_[position_++];
    value <<= 4U;
    if (digit >= '0' && digit <= '9') {
      value |= static_cast<unsigned>(digit - '0');
    } else if (digit >= 'a' && digit <= 'f') {
      value |= static_cast<unsigned>(digit - 'a' + 10);
    } else if (digit >= 'A' && digit <= 'F') {
      value |= static_cast<unsigned>(digit - 'A' + 10);
    } else {
      return false;
    }
  }
  if (value > 0x7FU || value == 0) {
    return false;
  }
  output.push_back(static_cast<char>(value));
  return true;
}

bool ObjectParser::parse_number(double& output) {
  const std::size_t start = position_;
  take('-');
  if (take('0')) {
    if (current() >= '0' && current() <= '9') {
      return false;
    }
  } else if (!consume_digits()) {
    return false;
  }
  if (take('.')) {
    if (!consume_digits()) {
      return false;
    }
  }
  if (current() == 'e' || current() == 'E') {
    ++position_;
    if (current() == '+' || current() == '-') {
      ++position_;
    }
    if (!consume_digits()) {
      return false;
    }
  }
  const std::string token = input_.substr(start, position_ - start);
  char* end = nullptr;
  output = std::strtod(token.c_str(), &end);
  return end != nullptr && *end == '\0' && std::isfinite(output);
}

bool ObjectParser::consume_digits() {
  const std::size_t start = position_;
  while (current() >= '0' && current() <= '9') {
    ++position_;
  }
  return position_ > start;
}

bool ObjectParser::consume_literal(const char* literal) {
  const std::size_t length = std::strlen(literal);
  if (input_.compare(position_, length, literal) != 0) {
    return false;
  }
  position_ += length;
  return true;
}

bool ObjectParser::consume_composite() {
  const char opening = current();
  const char closing = opening == '[' ? ']' : opening == '{' ? '}' : '\0';
  if (closing == '\0') {
    return false;
  }
  int depth = 0;
  bool in_string = false;
  bool escaped = false;
  while (!at_end()) {
    const char character = input_[position_++];
    if (in_string) {
      if (escaped) {
        escaped = false;
      } else if (character == '\\') {
        escaped = true;
      } else if (character == '"') {
        in_string = false;
      }
      continue;
    }
    if (character == '"') {
      in_string = true;
    } else if (character == opening) {
      ++depth;
    } else if (character == closing && --depth == 0) {
      return true;
    }
  }
  return false;
}

void ObjectParser::skip_whitespace() {
  while (current() == ' ' || current() == '\n' || current() == '\r' ||
         current() == '\t') {
    ++position_;
  }
}

bool ObjectParser::take(char expected) {
  if (current() != expected) {
    return false;
  }
  ++position_;
  return true;
}

char ObjectParser::current() const {
  return at_end() ? '\0' : input_[position_];
}

bool ObjectParser::at_end() const { return position_ >= input_.size(); }

bool split_array(const std::string& input, std::vector<std::string>& elements) {
  if (input.size() > kMaximumInputBytes) {
    return false;
  }
  if (input.size() < 2U || input.front() != '[' || input.back() != ']') {
    return false;
  }
  std::vector<std::string> parsed_elements;
  std::size_t start = 1U;
  int depth = 0;
  bool in_string = false;
  bool escaped = false;
  for (std::size_t index = 1U; index + 1U < input.size(); ++index) {
    const char value = input[index];
    if (in_string) {
      if (escaped) {
        escaped = false;
      } else if (value == '\\') {
        escaped = true;
      } else if (value == '"') {
        in_string = false;
      }
      continue;
    }
    if (value == '"') {
      in_string = true;
    } else if (value == '{' || value == '[') {
      ++depth;
    } else if (value == '}' || value == ']') {
      --depth;
      if (depth < 0) {
        return false;
      }
    } else if (value == ',' && depth == 0) {
      parsed_elements.push_back(input.substr(start, index - start));
      start = index + 1U;
    }
  }
  if (in_string || depth != 0 || start >= input.size() - 1U) {
    return false;
  }
  parsed_elements.push_back(input.substr(start, input.size() - 1U - start));
  elements = std::move(parsed_elements);
  return true;
}

}  // namespace philcoino::networking::json
