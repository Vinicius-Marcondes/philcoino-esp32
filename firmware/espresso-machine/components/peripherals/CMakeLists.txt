idf_component_register(
  SRCS "src/peripherals.cpp" "src/esp_peripherals.cpp"
  INCLUDE_DIRS "include"
  REQUIRES esp_driver_gpio esp_driver_i2c esp_driver_spi firmware_config nvs_flash
)

target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
