#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace philcoino::networking::json {

inline constexpr std::size_t kMaximumInputBytes = 1024U;

struct Value {
  enum class Type { kString, kNumber, kBoolean, kOther };

  Type type{Type::kOther};
  std::string string;
  double number{0.0};
  bool boolean{false};
};

struct Field {
  std::string key;
  Value value;
};

class ObjectParser {
 public:
  explicit ObjectParser(const std::string& input);
  ObjectParser(std::string&& input) = delete;

  bool parse(std::vector<Field>& fields);

 private:
  bool parse_value(Value& value);
  bool parse_string(std::string& output);
  bool parse_ascii_unicode(std::string& output);
  bool parse_number(double& output);
  bool consume_digits();
  bool consume_literal(const char* literal);
  bool consume_composite();
  void skip_whitespace();
  bool take(char expected);
  char current() const;
  bool at_end() const;

  const std::string& input_;
  std::size_t position_{0};
};

bool split_array(const std::string& input, std::vector<std::string>& elements);

}  // namespace philcoino::networking::json
