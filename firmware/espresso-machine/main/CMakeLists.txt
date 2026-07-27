idf_component_register(
  SRCS "app_main.cpp"
  REQUIRES control esp_hw_support esp_system esp_timer firmware_config freertos heap networking peripherals
)

target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
