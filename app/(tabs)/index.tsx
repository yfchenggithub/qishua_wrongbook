import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  BrandHeader,
  CardContainer,
  ProgressDots,
  ScreenContainer,
  SectionTitle,
  StatusPill,
} from "@/src/components";
import { todayMock, type TodayMistakeMock } from "@/src/mocks/today";
import { MistakeRepository, type MistakeStats } from "@/src/repositories";
import { Logger } from "@/src/services/Logger";
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from "@/src/styles/tokens";

function ThumbnailPlaceholder() {
  return (
    <View style={styles.thumb}>
      <View style={styles.thumbAxisX} />
      <View style={styles.thumbAxisY} />
      <View style={styles.thumbCurve} />
    </View>
  );
}

function MistakeCard({
  item,
  pressable,
}: {
  item: TodayMistakeMock;
  pressable?: () => void;
}) {
  const content = (
    <CardContainer padding={spacing.lg} style={styles.mistakeCard}>
      <View style={styles.mistakeRow}>
        <ThumbnailPlaceholder />

        <View style={styles.mistakeMain}>
          <View style={styles.mistakeTopLine}>
            <Text style={styles.mistakeMeta}>
              {item.code} · {item.module}
            </Text>
            <Text style={styles.arrow}>›</Text>
          </View>

          <Text style={styles.mistakeTitle}>{item.title}</Text>
          <Text style={styles.mistakeSource}>{item.source}</Text>

          <View style={styles.progressRow}>
            <ProgressDots
              total={item.progress.total}
              current={item.progress.current}
              completed={item.progress.completed}
            />
            <StatusPill label={item.statusLabel} tone={item.statusTone} />
          </View>
        </View>
      </View>
    </CardContainer>
  );

  if (!pressable) {
    return content;
  }

  return <Pressable onPress={pressable}>{content}</Pressable>;
}

export default function TodayScreen() {
  const router = useRouter();
  const [stats, setStats] = useState<MistakeStats>({
    total: 0,
    active: 0,
    mastered: 0,
    dueToday: 0,
  });
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadStats() {
      try {
        const result = await MistakeRepository.getMistakeStats();
        if (!active) {
          return;
        }
        setStats(result);
        setStatsError(null);
      } catch (error) {
        Logger.error("TodayScreen", "Failed to load mistake stats.", error);
        if (!active) {
          return;
        }
        setStats({
          total: 0,
          active: 0,
          mastered: 0,
          dueToday: 0,
        });
        setStatsError("统计读取失败，当前显示默认值 0");
      } finally {
        if (active) {
          setStatsLoaded(true);
        }
      }
    }

    loadStats();
    return () => {
      active = false;
    };
  }, []);

  const completionRate = useMemo(() => {
    if (stats.total <= 0) {
      return 0;
    }
    return Math.round((stats.mastered / stats.total) * 100);
  }, [stats.mastered, stats.total]);

  const summaryStats = useMemo(() => {
    return [
      {
        label: todayMock.taskSummary.stats[0]?.label ?? "总错题",
        value: String(stats.total),
      },
      {
        label: todayMock.taskSummary.stats[1]?.label ?? "已七刷",
        value: String(stats.mastered),
      },
      {
        label: todayMock.taskSummary.stats[2]?.label ?? "完成率",
        value: `${completionRate}%`,
      },
    ];
  }, [completionRate, stats.mastered, stats.total]);

  return (
    <ScreenContainer scroll contentStyle={styles.screenContent}>
      <BrandHeader
        title={todayMock.brand.title}
        subtitle={todayMock.brand.subtitle}
      />

      <CardContainer style={styles.taskSummaryCard} padding={spacing.xl}>
        <Text style={styles.taskCaption}>{todayMock.taskSummary.title}</Text>
        <View style={styles.taskDueRow}>
          <Text style={styles.taskDueCount}>{stats.dueToday}</Text>
          <Text style={styles.taskDueLabel}>
            {todayMock.taskSummary.dueLabel}
          </Text>
        </View>

        <View style={styles.taskStatsRow}>
          {summaryStats.map((stat) => (
            <View key={stat.label} style={styles.taskStatCell}>
              <Text style={styles.taskStatLabel}>{stat.label}</Text>
              <Text style={styles.taskStatValue}>{stat.value}</Text>
            </View>
          ))}
        </View>

        <Text
          style={[styles.statsHint, statsError ? styles.statsHintError : null]}
        >
          {statsError
            ? statsError
            : statsLoaded
              ? "统计来自本地 SQLite；下方错题卡片仍为静态 mock。"
              : "正在读取本地统计..."}
        </Text>
      </CardContainer>

      <View style={styles.sectionBlock}>
        <SectionTitle title="优先复做" />
        <View style={styles.sectionContent}>
          <MistakeCard
            item={todayMock.priority}
            pressable={() => router.push("/mistake/demo-1" as never)}
          />
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <SectionTitle title="错题队列" />
        <View style={styles.queueList}>
          {todayMock.queue.map((item) => (
            <MistakeCard key={item.id} item={item} />
          ))}
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screenContent: {
    paddingTop: spacing.lg,
    gap: spacing.xl,
  },
  taskSummaryCard: {
    backgroundColor: "#0B0B0D",
    borderColor: "#1B1B1F",
    borderRadius: radius.xl,
    ...shadows.floating,
  },
  taskCaption: {
    ...typography.bodySmall,
    color: "#C9CBD2",
    fontWeight: "600",
  },
  taskDueRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
  },
  taskDueCount: {
    ...typography.numberHero,
    color: colors.white,
    lineHeight: 72,
  },
  taskDueLabel: {
    ...typography.sectionTitle,
    color: colors.white,
    marginBottom: spacing.sm,
  },
  taskStatsRow: {
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm,
  },
  taskStatCell: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#2A2B31",
    backgroundColor: "#141519",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: 96,
    justifyContent: "space-between",
  },
  taskStatLabel: {
    ...typography.caption,
    color: "#C1C4CC",
    fontWeight: "600",
  },
  taskStatValue: {
    ...typography.sectionTitle,
    color: colors.white,
    fontSize: 34,
    lineHeight: 40,
  },
  statsHint: {
    marginTop: spacing.md,
    ...typography.caption,
    color: "#C1C4CC",
  },
  statsHintError: {
    color: "#F8B4B4",
  },
  sectionBlock: {
    gap: spacing.md,
  },
  sectionContent: {
    marginTop: spacing.xs,
  },
  queueList: {
    gap: spacing.md,
  },
  mistakeCard: {
    borderRadius: radius.xl,
  },
  mistakeRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  mistakeMain: {
    flex: 1,
    gap: spacing.sm,
  },
  mistakeTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mistakeMeta: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  arrow: {
    ...typography.body,
    color: colors.textMuted,
    fontSize: 24,
    lineHeight: 24,
  },
  mistakeTitle: {
    ...typography.sectionTitle,
    fontSize: 20,
    lineHeight: 28,
  },
  mistakeSource: {
    ...typography.body,
    color: colors.textSecondary,
  },
  progressRow: {
    marginTop: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  thumb: {
    width: 112,
    height: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  thumbAxisX: {
    position: "absolute",
    width: 76,
    height: 1.5,
    backgroundColor: "#8E949D",
  },
  thumbAxisY: {
    position: "absolute",
    width: 1.5,
    height: 76,
    backgroundColor: "#8E949D",
  },
  thumbCurve: {
    width: 54,
    height: 40,
    borderWidth: 1.5,
    borderColor: "#8E949D",
    borderRadius: radius.pill,
    transform: [{ rotate: "-18deg" }],
  },
});
