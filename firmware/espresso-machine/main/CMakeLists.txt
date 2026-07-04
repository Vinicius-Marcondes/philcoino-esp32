idf_component_register(
  SRCS "app_main.cpp"
  REQUIRES esp_hw_support esp_timer firmware_config freertos peripherals
)

target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
