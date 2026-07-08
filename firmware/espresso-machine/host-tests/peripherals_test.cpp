#include <algorithm>
#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "philcoino/peripherals.hpp"

namespace {

using namespace philcoino::peripherals;

class FakeMax6675Transport final : public Max6675Transport {
 public:
  bool read_frame(ThermocoupleChannel channel, std::uint16_t& frame) override {
    assert(!read_active);
    read_active = true;
    channels.push_back(channel);
    const auto index = channel == ThermocoupleChannel::kBrew ? 0U : 1U;
    frame = frames[index];
    read_active = false;
    return succeeds[index];
  }

  std::array<std::uint16_t, 2> frames{};
  std::array<bool, 2> succeeds{true, true};
  std::vector<ThermocoupleChannel> channels{};
  bool read_active{false};
};

struct MemoryState {
  bool present{false};
  bool fail_load{false};
  bool fail_save{false};
  TemperatureTargets targets{};
};

class MemoryBackend final : public TargetBackend {
 public:
  explicit MemoryBackend(MemoryState& state) : state_(state) {}

  BackendLoadResult load(TemperatureTargets& targets) override {
    if (state_.fail_load) {
      return BackendLoadResult::kError;
    }
    if (!state_.present) {
      return BackendLoadResult::kNotFound;
    }
    targets = state_.targets;
    return BackendLoadResult::kOk;
  }

  bool save(const TemperatureTargets& targets) override {
    if (state_.fail_save) {
      return false;
    }
    state_.targets = targets;
    state_.present = true;
    return true;
  }

 private:
  MemoryState& state_;
};

enum class OutputEvent { kLow, kHigh, kConfigure };

class FakeDigitalOutput final : public DigitalOutput {
 public:
  bool set_level(bool high) override {
    events.push_back(high ? OutputEvent::kHigh : OutputEvent::kLow);
    level = high;
    if (high && fail_high) {
      return false;
    }
    return !fail_low;
  }

  bool configure_output() override {
    events.push_back(OutputEvent::kConfigure);
    configured = true;
    return !fail_configure;
  }

  std::vector<OutputEvent> events{};
  bool level{true};
  bool configured{false};
  bool fail_low{false};
  bool fail_high{false};
  bool fail_configure{false};
};

class FakeOledTransport final : public OledTransport {
 public:
  bool write_command(const std::uint8_t* bytes, std::size_t length) override {
    commands.insert(commands.end(), bytes, bytes + length);
    return succeed;
  }

  bool write_data(const std::uint8_t* bytes, std::size_t length) override {
    data.assign(bytes, bytes + length);
    return succeed;
  }

  std::vector<std::uint8_t> commands{};
  std::vector<std::uint8_t> data{};
  bool succeed{true};
};

void test_thermocouples() {
  static_assert(kMax6675SampleIntervalMs >= kMax6675ConversionMs);

  FakeMax6675Transport transport;
  transport.frames = {
      static_cast<std::uint16_t>(373U << 3U),
      static_cast<std::uint16_t>(460U << 3U),
  };
  DualMax6675 sensors(transport, 0);

  const auto early = sensors.read(219);
  assert(early.brew.status == ThermocoupleStatus::kNotReady);
  assert(early.steam.status == ThermocoupleStatus::kNotReady);
  assert(transport.channels.empty());

  const auto first = sensors.read(220);
  assert(first.brew.status == ThermocoupleStatus::kOk);
  assert(first.brew.temperature_c == 93.25F);
  assert(first.steam.status == ThermocoupleStatus::kOk);
  assert(first.steam.temperature_c == 115.0F);
  assert((transport.channels ==
          std::vector<ThermocoupleChannel>{ThermocoupleChannel::kBrew,
                                          ThermocoupleChannel::kSteam}));

  sensors.read(439);
  assert(transport.channels.size() == 2);

  transport.frames = {0x0004, 0x0002};
  const auto faults = sensors.read(440);
  assert(faults.brew.status == ThermocoupleStatus::kOpenCircuit);
  assert(faults.steam.status == ThermocoupleStatus::kInvalidFrame);

  transport.succeeds[1] = false;
  const auto transport_error = sensors.read(660);
  assert(transport_error.steam.status ==
         ThermocoupleStatus::kTransportError);
}

void test_target_storage() {
  MemoryState state;
  {
    MemoryBackend backend(state);
    TargetStorage storage(backend);
    TemperatureTargets targets{};
    assert(storage.load(targets) == TargetLoadResult::kInitializedDefaults);
    assert(targets.brew_c == 93);
    assert(targets.steam_c == 115);
    assert(storage.save({95, 120}));
    assert(!storage.save({84, 120}));
  }
  {
    MemoryBackend restarted_backend(state);
    TargetStorage restarted_storage(restarted_backend);
    TemperatureTargets restored{};
    assert(restarted_storage.load(restored) == TargetLoadResult::kOk);
    assert(restored.brew_c == 95);
    assert(restored.steam_c == 120);
  }

  state.targets = {96, 115};
  MemoryBackend corrupt_backend(state);
  TargetStorage corrupt_storage(corrupt_backend);
  TemperatureTargets corrupt{};
  assert(corrupt_storage.load(corrupt) == TargetLoadResult::kCorrupt);
}

void test_fail_off_ssr() {
  FakeDigitalOutput output;
  FailOffSsr ssr(output);
  assert(ssr.initialize());
  assert((output.events == std::vector<OutputEvent>{OutputEvent::kLow,
                                                    OutputEvent::kConfigure,
                                                    OutputEvent::kLow}));
  assert(!output.level);
  assert(!ssr.is_enabled());
  assert(ssr.set_enabled(true));
  assert(ssr.is_enabled());

  output.fail_high = true;
  assert(!ssr.set_enabled(true));
  assert(!output.level);
  assert(!ssr.is_enabled());

  FakeDigitalOutput configuration_error;
  configuration_error.fail_configure = true;
  FailOffSsr failed_ssr(configuration_error);
  assert(!failed_ssr.initialize());
  assert(!configuration_error.level);
  assert(!failed_ssr.set_enabled(true));
  assert(!configuration_error.level);

  FakeDigitalOutput active_low_output;
  FailOffSsr active_low_ssr(active_low_output, false);
  assert(active_low_ssr.initialize());
  assert(active_low_output.level);
  assert(active_low_ssr.set_enabled(true));
  assert(!active_low_output.level);
  assert(active_low_ssr.force_off());
  assert(active_low_output.level);
}

void test_oled() {
  FakeOledTransport transport;
  Ssd1306Display display(transport);
  DisplaySnapshot snapshot{};
  snapshot.brew = {true, 93.25F};
  snapshot.steam = {true, 115.0F};
  snapshot.mode = DisplayMode::kBrew;
  snapshot.status = DisplayStatus::kReady;
  snapshot.heater_enabled = true;

  assert(!display.render(snapshot));
  assert(display.initialize());
  assert(std::find(transport.commands.begin(), transport.commands.end(), 0x1F) !=
         transport.commands.end());
  assert(display.render(snapshot));
  assert(transport.data.size() == Ssd1306Display::kBufferSize);
  assert(std::any_of(transport.data.begin(), transport.data.end(),
                     [](std::uint8_t value) { return value != 0; }));
  const auto wifi_off_frame = transport.data;
  constexpr std::array wifi_states{
      DisplayWifiStatus::kConnecting,
      DisplayWifiStatus::kConnected,
      DisplayWifiStatus::kRetrying,
      DisplayWifiStatus::kFailed,
  };
  for (const auto wifi_status : wifi_states) {
    snapshot.wifi_status = wifi_status;
    assert(display.render(snapshot));
    assert(std::equal(wifi_off_frame.begin(),
                      wifi_off_frame.begin() + 3 * Ssd1306Display::kWidth,
                      transport.data.begin()));
    assert(!std::equal(wifi_off_frame.begin() + 3 * Ssd1306Display::kWidth,
                       wifi_off_frame.end(),
                       transport.data.begin() + 3 * Ssd1306Display::kWidth));
  }
  assert(transport.commands.size() == 55);
}

}  // namespace

int main() {
  test_thermocouples();
  test_target_storage();
  test_fail_off_ssr();
  test_oled();
  return 0;
}
