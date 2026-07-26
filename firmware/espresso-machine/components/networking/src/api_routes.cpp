#include "philcoino/api_routes.hpp"

#include <string_view>

namespace philcoino::networking {

const ApiRouteDescriptor* find_api_route(HttpMethod method,
                                         const std::string& path) {
  const auto query = path.find('?');
  const std::string_view route_path(
      path.data(), query == std::string::npos ? path.size() : query);
  for (const auto& route : kApiRoutes) {
    if (route.method == method &&
        route_path == std::string_view(route.path)) {
      return &route;
    }
  }
  return nullptr;
}

bool request_requires_auth(HttpMethod method, const std::string& path) {
  const auto* route = find_api_route(method, path);
  return route != nullptr && route->requires_authentication;
}

}  // namespace philcoino::networking
