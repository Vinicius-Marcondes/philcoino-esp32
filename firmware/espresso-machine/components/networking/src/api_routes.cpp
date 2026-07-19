#include "philcoino/api_routes.hpp"

namespace philcoino::networking {

const ApiRouteDescriptor* find_api_route(HttpMethod method,
                                         const std::string& path) {
  const auto query = path.find('?');
  const auto route_path = path.substr(0, query);
  for (const auto& route : kApiRoutes) {
    if (route.method == method && route_path == route.path) {
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
