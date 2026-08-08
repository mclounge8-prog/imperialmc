import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import FastImage from '@d11/react-native-fast-image';
import LinearGradient from 'react-native-linear-gradient';
import { colors } from '../theme/colors';
import { API_BASE_URL } from '../api/client';
import type { MenuItem, MenuResponse } from '../api/client';

// Единый синий градиент вместо разноцветной палитры — категории выдержаны
// в одной айдентике, не в случайных системных цветах
const GRADIENT_BLUE: [string, string] = [colors.accent, colors.accent2];

type Props = {
  menu: MenuResponse | null;
  busy?: boolean;
  onItemPress: (item: MenuItem) => void;
};

export default function MenuBrowser({ menu, busy = false, onItemPress }: Props) {
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || !menu) return null;
    const all: MenuItem[] = [...menu.categories.flatMap((c) => c.items), ...menu.uncategorized];
    return all.filter((item) => item.name.toLowerCase().includes(query));
  }, [searchQuery, menu]);

  const activeCategory = menu?.categories.find((c) => c.id === activeCategoryId) ?? null;

  const renderItemTile = (item: MenuItem) => (
    <Pressable key={item.id} style={styles.itemTile} disabled={busy} onPress={() => onItemPress(item)}>
      {item.imageUrl ? (
        <>
          <FastImage
            source={{
              uri: `${API_BASE_URL}${item.imageUrl}`,
              cache: FastImage.cacheControl.immutable,
            }}
            style={styles.itemTileImage}
          />
          <View style={styles.itemTileCaption}>
            <Text style={styles.itemTileNameCompact} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.itemTilePrice}>{item.price.toFixed(2)} ₽</Text>
          </View>
        </>
      ) : (
        <View style={styles.itemTileNoImage}>
          <Text style={styles.itemTileName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.itemTilePrice}>{item.price.toFixed(2)} ₽</Text>
        </View>
      )}
    </Pressable>
  );

  return (
    <View style={styles.menuPane}>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Поиск по меню"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      <ScrollView contentContainerStyle={styles.menuScrollContent}>
        {searchResults !== null ? (
          <View style={styles.tileGrid}>
            {searchResults.length === 0 ? (
              <Text style={styles.emptyText}>Ничего не найдено</Text>
            ) : (
              searchResults.map((item) => renderItemTile(item))
            )}
          </View>
        ) : activeCategory ? (
          <>
            <Pressable style={styles.backTile} onPress={() => setActiveCategoryId(null)}>
              <Text style={styles.backTileText}>← Назад</Text>
            </Pressable>
            {activeCategory.items.length === 0 ? (
              <Text style={styles.emptyText}>В этой категории пока нет позиций</Text>
            ) : (
              <View style={styles.tileGrid}>{activeCategory.items.map((item) => renderItemTile(item))}</View>
            )}
          </>
        ) : (
          <View style={styles.tileGrid}>
            {menu?.categories.map((cat) => (
              <Pressable
                key={`cat-${cat.id}`}
                style={styles.categoryTileWrapper}
                onPress={() => setActiveCategoryId(cat.id)}
              >
                <LinearGradient
                  colors={GRADIENT_BLUE}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.categoryTile}
                >
                  {cat.icon ? <Text style={styles.categoryTileIcon}>{cat.icon}</Text> : null}
                  <Text style={styles.categoryTileName} numberOfLines={2}>
                    {cat.name}
                  </Text>
                </LinearGradient>
              </Pressable>
            ))}
            {menu?.uncategorized.map((item) => renderItemTile(item))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  menuPane: { flex: 1 },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', padding: 16 },
  searchBar: { padding: 16, paddingBottom: 0 },
  searchInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
  },
  menuScrollContent: { padding: 16 },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  backTile: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  backTileText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  categoryTileWrapper: {
    width: '31%',
    minHeight: 150,
  },
  categoryTile: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    gap: 6,
  },
  categoryTileIcon: { fontSize: 34, lineHeight: 40 },
  categoryTileName: { color: '#ffffff', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  itemTile: {
    width: '31%',
    minHeight: 150,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  itemTileImage: {
    width: '100%',
    height: 100,
  },
  itemTileCaption: {
    padding: 8,
    alignItems: 'center',
    gap: 2,
  },
  itemTileNameCompact: { color: colors.text, fontSize: 13, fontWeight: '600' },
  itemTileNoImage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    gap: 6,
  },
  itemTileName: { color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  itemTilePrice: { color: colors.accent2, fontSize: 13, fontWeight: '600' },
});