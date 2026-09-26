import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { KioskSecretPressable } from './KioskChrome';
import { kk, kioskAssets } from './theme';

type Props = {
  venueName?: string;
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
};

const SIZES = { sm: 44, md: 72, lg: 168 };

export default function BrandMark({ venueName, size = 'md', showWordmark = true }: Props) {
  const dim = SIZES[size];
  return (
    <KioskSecretPressable style={[styles.wrap, size === 'lg' && styles.wrapLg]}>
      <Image source={kioskAssets.logo} style={{ width: dim, height: dim }} resizeMode="contain" />
      {showWordmark ? (
        <View style={[styles.copy, size === 'lg' && styles.copyLg]}>
          <Text style={[styles.brand, size === 'lg' && styles.brandLg]}>KEBAB KING</Text>
          {venueName ? (
            <Text style={styles.venue} numberOfLines={1}>
              {venueName}
            </Text>
          ) : (
            <Text style={styles.est}>EST. 2024</Text>
          )}
        </View>
      ) : null}
    </KioskSecretPressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrapLg: { flexDirection: 'column', gap: 8 },
  copy: { minWidth: 0 },
  copyLg: { alignItems: 'center' },
  brand: {
    color: kk.gold,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  brandLg: { fontSize: 34, letterSpacing: 2 },
  venue: { color: kk.cream, fontSize: 13, fontWeight: '700', marginTop: 2 },
  est: { color: kk.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.6, marginTop: 2 },
});
