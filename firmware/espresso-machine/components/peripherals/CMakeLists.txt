idf_component_register(
  SRCS "src/peripherals.cpp" "src/esp_peripherals.cpp"
  INCLUDE_DIRS "include"
  REQUIRES esp_driver_gpio esp_driver_i2c firmware_config freertos nvs_flash
)

target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
