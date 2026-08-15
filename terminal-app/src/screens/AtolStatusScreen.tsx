import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchAtolSettings,
  fetchFiscalJobs,
  retryAllFiscalJobs,
  retryFiscalJob,
  type AtolSettings,
  type FiscalJobListItem,
} from '../api/client';
import { useDevice } from '../context/DeviceContext';
import { useFiscalAlerts } from '../context/FiscalAlertsContext';
import { useSession } from '../context/SessionContext';
import { isAtolDriverAppInstalled } from '../native/atol';
import { runPendingFiscalJobs } from '../services/fiscalWorker';
import { colors } from '../theme/colors';

const OK_GREEN = '#3d9a6a';

const TYPE_LABELS: Record<string, string> = {
  open_shift: 'Открытие смены',
  close_shift: 'Закрытие смены',
  x_report: 'X-отчёт',
  receipt: 'Чек',
  cash_in: 'Внесение',
  cash_out: 'Инкассация',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'В очереди',
  in_progress: 'Выполняется',
  done: 'Готово',
  error: 'Ошибка',
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function statusColor(status: string): string {
  if (status === 'error') return colors.danger;
  if (status === 'done') return OK_GREEN;
  if (status === 'in_progress') return colors.accent2;
  return colors.textMuted;
}

function isStuck(job: FiscalJobListItem): boolean {
  if (job.status !== 'in_progress' || !job.updatedAt) return false;
  const ageMs = Date.now() - new Date(job.updatedAt).getTime();
  return ageMs > 2 * 60 * 1000;
}

function canRetry(job: FiscalJobListItem): boolean {
  return job.status === 'error' || isStuck(job);
}

export default function AtolStatusScreen() {
  const { session } = useSession();
  const { status: deviceStatus } = useDevice();
  const venueId = deviceStatus?.venue?.id ?? null;
  const {
    setServerErrorCount,
    setPendingJobCount,
    setAtolEnabled,
    setServerOnline,
    clearAlerts,
    serverOnline,
    serverMessage,
    errorCount,
    pendingJobCount,
  } = useFiscalAlerts();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AtolSettings | null>(null);
  const [jobs, setJobs] = useState<FiscalJobListItem[]>([]);
  const [driverInstalled, setDriverInstalled] = useState<boolean | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [draining, setDraining] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);

  const load = useCallback(async () => {
    if (!venueId || !session?.token) return;
    setError(null);
    try {
      const [settingsRes, jobsRes, driver] = await Promise.all([
        fetchAtolSettings(venueId, session.token),
        fetchFiscalJobs(venueId, session.token, 50),
        isAtolDriverAppInstalled(),
      ]);
      setSettings(settingsRes);
      setJobs(jobsRes.jobs);
      setServerOnline(true);
      setServerErrorCount(jobsRes.errorCount);
      setPendingJobCount(jobsRes.pendingCount ?? 0);
      setAtolEnabled(Boolean(settingsRes.enabled));
      setDriverInstalled(driver);
      if (jobsRes.errorCount === 0) clearAlerts('atol');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setServerOnline(false, message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [
    venueId,
    session?.token,
    setServerErrorCount,
    setPendingJobCount,
    setAtolEnabled,
    setServerOnline,
    clearAlerts,
  ]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
  };

  const onRetry = async (jobId: number) => {
    if (!venueId || !session?.token) return;
    setRetryingId(jobId);
    setError(null);
    try {
      await retryFiscalJob(jobId, venueId, session.token);
      await runPendingFiscalJobs(venueId, session.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingId(null);
    }
  };

  const onRetryAll = async () => {
    if (!venueId || !session?.token) return;
    setRetryingAll(true);
    setError(null);
    try {
      await retryAllFiscalJobs(venueId, session.token, { includeStuck: true });
      await runPendingFiscalJobs(venueId, session.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetryingAll(false);
    }
  };

  const onDrainQueue = async () => {
    if (!venueId || !session?.token) return;
    setDraining(true);
    setError(null);
    try {
      await runPendingFiscalJobs(venueId, session.token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDraining(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent2} size="large" />
      </View>
    );
  }

  const serverOk = serverOnline !== false;
  const atolOk = errorCount === 0;
  const errorJobs = jobs.filter((j) => j.status === 'error' || isStuck(j));

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent2} />}
    >
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <Text style={styles.sectionLabel}>Уведомления</Text>
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Сервер</Text>
          <Text style={[styles.infoValue, { color: serverOk ? OK_GREEN : colors.danger }]}>
            {serverOk ? 'OK' : serverMessage || 'нет связи'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>АТОЛ / фискализация</Text>
          <Text style={[styles.infoValue, { color: atolOk ? OK_GREEN : colors.danger }]}>
            {atolOk
              ? pendingJobCount > 0
                ? `OK · в очереди ${pendingJobCount}`
                : 'OK · ошибок нет'
              : `ошибок: ${errorCount}`}
          </Text>
        </View>
        <View style={[styles.infoRow, styles.infoRowLast]}>
          <Text style={styles.infoKey}>Что покрываем</Text>
          <Text style={styles.infoValueMuted}>
            чеки, смена, внесение/инкассация, обрыв связи, зависания
          </Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Касса</Text>
      <View style={styles.card}>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Касса в заведении</Text>
          <Text style={[styles.infoValue, { color: settings?.enabled ? OK_GREEN : colors.textMuted }]}>
            {settings?.enabled ? 'включена' : 'выключена'}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoKey}>Драйвер ККТ на планшете</Text>
          <Text
            style={[
              styles.infoValue,
              { color: driverInstalled ? OK_GREEN : colors.danger },
            ]}
          >
            {driverInstalled == null ? '—' : driverInstalled ? 'установлен' : 'не найден'}
          </Text>
        </View>
        {settings?.enabled ? (
          <>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>Адрес</Text>
              <Text style={styles.infoValue}>
                {settings.ipAddress}:{settings.ipPort ?? 5555}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoKey}>Модель (код)</Text>
              <Text style={styles.infoValue}>{settings.model ?? '—'}</Text>
            </View>
            <View style={[styles.infoRow, styles.infoRowLast]}>
              <Text style={styles.infoKey}>Кассир</Text>
              <Text style={styles.infoValue}>{settings.operatorName || '—'}</Text>
            </View>
          </>
        ) : (
          <View style={[styles.infoRow, styles.infoRowLast]}>
            <Text style={styles.infoValueMuted}>Фискализация отключена в бэкофисе</Text>
          </View>
        )}
      </View>

      {!driverInstalled && settings?.enabled ? (
        <Text style={styles.hint}>
          Установите приложение «Драйвер ККТ АТОЛ» (ru.atol.drivers10.service) на этот планшет —
          без него фискализация невозможна.
        </Text>
      ) : null}

      <Pressable style={styles.primaryButton} disabled={draining || !settings?.enabled} onPress={onDrainQueue}>
        {draining ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.primaryButtonText}>Обработать очередь сейчас</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.secondaryButton, errorJobs.length === 0 && styles.buttonDisabled]}
        disabled={retryingAll || errorJobs.length === 0}
        onPress={onRetryAll}
      >
        {retryingAll ? (
          <ActivityIndicator color={colors.accent2} />
        ) : (
          <Text style={styles.secondaryButtonText}>
            Повторить все ошибки{errorJobs.length ? ` (${errorJobs.length})` : ''}
          </Text>
        )}
      </Pressable>

      <Text style={styles.sectionLabel}>Задания</Text>
      {jobs.length === 0 ? (
        <Text style={styles.empty}>Заданий пока не было</Text>
      ) : (
        <View style={styles.card}>
          {jobs.map((job, idx) => (
            <View key={job.id} style={[styles.jobRow, idx < jobs.length - 1 && styles.jobBorder]}>
              <View style={styles.jobTop}>
                <Text style={styles.jobType}>{TYPE_LABELS[job.type] || job.type}</Text>
                <Text style={[styles.jobStatus, { color: statusColor(job.status) }]}>
                  {STATUS_LABELS[job.status] || job.status}
                  {isStuck(job) ? ' · зависло' : ''}
                </Text>
              </View>
              <Text style={styles.jobMeta}>
                #{job.id} · попыток {job.attempts} · {formatWhen(job.createdAt)}
                {job.fiscalDocNumber != null ? ` · ФД ${job.fiscalDocNumber}` : ''}
                {job.fiscalSign ? ` · ФПД ${job.fiscalSign}` : ''}
              </Text>
              {job.lastError ? <Text style={styles.jobError}>{job.lastError}</Text> : null}
              {canRetry(job) ? (
                <Pressable
                  style={styles.retryButton}
                  disabled={retryingId === job.id}
                  onPress={() => onRetry(job.id)}
                >
                  {retryingId === job.id ? (
                    <ActivityIndicator color={colors.text} size="small" />
                  ) : (
                    <Text style={styles.retryButtonText}>Повторить</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoKey: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  infoValue: { color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  infoValueMuted: { color: colors.textMuted, fontSize: 12, textAlign: 'right', flex: 1 },
  hint: { color: colors.textMuted, fontSize: 12, marginHorizontal: 4, marginBottom: 4 },
  primaryButton: {
    marginTop: 8,
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: { color: colors.accent2, fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.45 },
  empty: { color: colors.textMuted, fontSize: 13, marginLeft: 4 },
  jobRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  jobBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  jobTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  jobType: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  jobStatus: { fontSize: 13, fontWeight: '700' },
  jobMeta: { color: colors.textMuted, fontSize: 12 },
  jobError: { color: colors.danger, fontSize: 12, marginTop: 2 },
  retryButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 110,
    alignItems: 'center',
  },
  retryButtonText: { color: colors.accent2, fontSize: 13, fontWeight: '600' },
  errorBanner: {
    color: colors.danger,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
  },
});
