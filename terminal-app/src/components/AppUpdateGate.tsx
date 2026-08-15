import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../theme/colors';
import { subscribeDownloadProgress } from '../native/updates';
import {
  applyApkUpdate,
  applyJsUpdate,
  planUpdate,
  type UpdatePlan,
} from '../services/appUpdates';
import { CHECK_UPDATES_EVENT } from '../services/updateEvents';

type Props = {
  /** Автопроверка при монтировании */
  autoCheck?: boolean;
};

export default function AppUpdateGate({ autoCheck = true }: Props) {
  const [plan, setPlan] = useState<UpdatePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checkingRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setError(null);
    try {
      const next = await planUpdate();
      setPlan(next);
      setDismissed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка проверки обновлений');
      setPlan({ kind: 'none' });
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (autoCheck) {
      void runCheck();
    }
  }, [autoCheck, runCheck]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CHECK_UPDATES_EVENT, () => {
      void runCheck();
    });
    return () => sub.remove();
  }, [runCheck]);

  useEffect(() => {
    return subscribeDownloadProgress((event) => {
      setProgress(Math.max(0, Math.min(1, event.progress)));
    });
  }, []);

  const visible =
    plan != null &&
    plan.kind !== 'none' &&
    !dismissed &&
    (plan.kind === 'apk' || plan.kind === 'js');

  const onInstall = async () => {
    if (!plan || plan.kind === 'none') return;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      if (plan.kind === 'apk') {
        await applyApkUpdate(plan);
        // После системного установщика приложение обычно закрывается/обновляется.
      } else {
        await applyJsUpdate(plan);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не удалось установить обновление';
      if (message === 'NEED_INSTALL_PERMISSION') {
        setError(
          'Разрешите установку из этого источника в настройках Android, затем нажмите «Установить» снова.'
        );
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const canSkip =
    plan != null &&
    plan.kind !== 'none' &&
    !plan.remote.mandatory &&
    !busy;

  if (!visible) return null;

  const title =
    plan.kind === 'apk' ? 'Доступно обновление приложения' : 'Доступно обновление интерфейса';
  const subtitle =
    plan.kind === 'apk'
      ? `${plan.localVersionName} (${plan.localVersionCode}) → ${plan.remote.versionName} (${plan.remote.versionCode})`
      : `JS ${plan.localJsVersion} → ${plan.remote.version}`;
  const notes = plan.remote.notes?.trim();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => canSkip && setDismissed(true)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {notes ? <Text style={styles.notes}>{notes}</Text> : null}
          {busy ? (
            <View style={styles.progressBlock}>
              <ActivityIndicator color={colors.accent2} />
              <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
            </View>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            {canSkip ? (
              <Pressable style={styles.secondaryBtn} onPress={() => setDismissed(true)}>
                <Text style={styles.secondaryText}>Позже</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.primaryBtn} disabled={busy} onPress={() => void onInstall()}>
              <Text style={styles.primaryText}>{busy ? 'Загрузка…' : 'Установить'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 10,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13 },
  notes: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  progressBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  progressText: { color: colors.textMuted, fontSize: 13 },
  error: { color: '#e57373', fontSize: 13, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  primaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: colors.accent2,
  },
  primaryText: { color: '#111', fontSize: 14, fontWeight: '700' },
});
