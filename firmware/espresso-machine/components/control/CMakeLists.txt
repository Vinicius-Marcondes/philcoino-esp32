idf_component_register(
  SRCS "src/control.cpp"
  INCLUDE_DIRS "include"
  REQUIRES firmware_config peripherals
)

target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
