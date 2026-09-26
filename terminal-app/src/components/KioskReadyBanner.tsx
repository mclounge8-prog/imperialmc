import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import type { KioskTicket } from '../api/client';
import { kk } from '../kiosk/theme';

type Props = {
  tickets: KioskTicket[];
};

export default function KioskReadyBanner({ tickets }: Props) {
  const ready = tickets.filter((t) => t.status === 'ready');
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (!ready.length) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 520, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, ready.length]);

  if (!ready.length) return null;

  const numbers = ready.map((t) => `№ ${t.number}`).join('   ·   ');

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View style={[styles.card, { opacity: pulse }]}>
        <Text style={styles.kicker}>Заказ готов</Text>
        <Text style={styles.nums}>{numbers}</Text>
        <Text style={styles.sub}>Подойди к выдаче</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 30,
  },
  card: {
    minWidth: 280,
    maxWidth: 640,
    backgroundColor: kk.gold,
    borderWidth: 3,
    borderColor: '#fff3c4',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 22,
    alignItems: 'center',
  },
  kicker: {
    color: kk.ink,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontSize: 13,
  },
  nums: { color: kk.ink, fontSize: 34, fontWeight: '800', marginTop: 2 },
  sub: { color: '#3a2a08', fontSize: 15, fontWeight: '700', marginTop: 2 },
});
