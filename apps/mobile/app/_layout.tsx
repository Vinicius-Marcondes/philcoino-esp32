import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useLocales } from 'expo-localization';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useWindowDimensions } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { mobileLayoutMode } from '@/src/layout/responsive-layout';
import { setAppLocale, translate } from '@/src/localization/i18n';

export const unstable_settings = {
  anchor: 'index',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const locales = useLocales();
  const windowSize = useWindowDimensions();
  const landscape = mobileLayoutMode(windowSize) === 'landscape';
  const hideNativeHeader = process.env.EXPO_OS === 'android' || landscape;
  setAppLocale(locales[0]?.languageCode ?? null);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: '#F4F0E8' },
          headerBlurEffect: undefined,
          headerShadowVisible: true,
          headerShown: !hideNativeHeader,
          headerTitle: '',
          headerTransparent: true,
        }}>
        <Stack.Screen
          name="index"
          options={{
            headerLargeTitle: false,
            title: translate('navigation.pairMachine'),
          }}
        />
      </Stack>
      <StatusBar style={hideNativeHeader ? 'dark' : 'auto'} />
    </ThemeProvider>
  );
}
