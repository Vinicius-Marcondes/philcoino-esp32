idf_component_register(
  SRCS
    "src/api.cpp"
    "src/api_codec.cpp"
    "src/api_json.cpp"
    "src/api_machine_codec.cpp"
    "src/api_routes.cpp"
    "src/api_workflow_codec.cpp"
    "src/esp_networking.cpp"
  INCLUDE_DIRS "include"
  REQUIRES control firmware_config peripherals
  PRIV_REQUIRES esp_event esp_http_server esp_netif esp_timer esp_wifi espressif__mdns
)

target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
