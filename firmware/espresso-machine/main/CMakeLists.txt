set(main_sources "app_main.cpp")
if(CONFIG_PHILCOINO_PERFORMANCE_DIAGNOSTICS)
  list(APPEND main_sources "performance_diagnostics.cpp")
endif()

idf_component_register(
  SRCS ${main_sources}
  REQUIRES control esp_hw_support esp_system esp_timer esp_wifi firmware_config freertos heap networking peripherals
)

target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
