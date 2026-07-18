#include "philcoino/api_codec.hpp"

#include <sstream>
#include <utility>

namespace philcoino::networking::codec {

HttpResponse json_response(int status, std::string body,
                           bool bearer_challenge) {
  return {status, std::move(body), bearer_challenge};
}

HttpResponse error_response(int status, const char* code, const char* message,
                            bool bearer_challenge) {
  std::ostringstream output;
  output << "{\"error\":{\"code\":\"" << code << "\",\"message\":\""
         << message << "\"}}";
  return json_response(status, output.str(), bearer_challenge);
}

}  // namespace philcoino::networking::codec
