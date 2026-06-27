export function average(values) {
  const cleanValues = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value));
  if (cleanValues.length === 0) return 0;
  return Math.round(cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length);
}

export function clampPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function formatMetricDisplay(value) {
  const percent = clampPercent(value);
  return {
    percent,
    label: `${percent}%`,
    status: percent >= 100 ? "perfect" : percent <= 0 ? "empty" : "partial",
  };
}

export function hasAnalyticsData(summary) {
  return Boolean(summary?.week);
}

export function formatPercent(value) {
  return formatMetricDisplay(value).label;
}

export function riskLevel(score) {
  const value = Number(score || 0);
  if (value < 20) return "Critical";
  if (value < 40) return "High";
  if (value < 70) return "Medium";
  return "Low";
}

export function riskReason(row) {
  if (row.week === "No data") return "No data yet";
  if (Number(row.attendance || 0) < 50) return "Low attendance";
  if (Number(row.participation || 0) < 50) return "Low participation";
  if (Number(row.engagement || 0) < 65) return "Low engagement";
  return "On track";
}

export function classAnalyticsRows(classes, summaries) {
  const summariesByClassId = new Map(summaries.map((summary) => [summary.class_id, summary]));
  return classes.map((classDoc) => {
    const summary = summariesByClassId.get(classDoc.class_id) || {};
    const engagement = Math.round(Number(summary.average_engagement_score || 0));
    const attendance = Math.round(Number(summary.average_attendance_rate || 0));
    const participation = Math.round(Number(summary.average_participation_rate || 0));
    const hasAnalytics = Boolean(summary.week);
    return {
      id: classDoc.class_id,
      class_id: classDoc.class_id,
      className: classDoc.name,
      semester: classDoc.semester || "",
      attendance,
      participation,
      engagement,
      activeStudents: summary.active_students || 0,
      totalStudents: summary.total_students || 0,
      week: summary.week || "No data",
      risk: hasAnalytics ? riskLevel(engagement) : "Low",
    };
  });
}

export function aggregateWeeklyAverages(summaries) {
  const weeks = new Map();
  for (const summary of summaries) {
    for (const point of summary.weekly_averages || []) {
      const row = weeks.get(point.week) || {
        week: point.week,
        attendanceValues: [],
        participationValues: [],
        engagementValues: [],
        activeStudents: 0,
      };
      row.attendanceValues.push(point.average_attendance_rate || 0);
      row.participationValues.push(point.average_participation_rate || 0);
      row.engagementValues.push(point.average_engagement_score || 0);
      row.activeStudents += point.active_students || 0;
      weeks.set(point.week, row);
    }
  }
  return [...weeks.values()]
    .sort((first, second) => first.week.localeCompare(second.week))
    .map((row) => ({
      week: row.week,
      attendance: average(row.attendanceValues),
      participation: average(row.participationValues),
      engagement: average(row.engagementValues),
      activeStudents: row.activeStudents,
    }));
}

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function isoWeekStartDate(week) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(week || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const weekNumber = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1 + ((weekNumber - 1) * 7));
  return monday;
}

function parseTrendDate(point) {
  const rawDate = point.date || point.day || point.created_at || point.calculated_at || point.period_start;
  if (rawDate) {
    const date = new Date(rawDate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return isoWeekStartDate(point.week);
}

function periodBucket(point, period) {
  const date = parseTrendDate(point);
  if (period === "week") {
    return {
      key: point.week || (date ? date.toISOString().slice(0, 10) : "No date"),
      label: point.week || (date ? dayFormatter.format(date) : "No date"),
      sortValue: date?.getTime() ?? 0,
    };
  }
  if (!date) {
    return { key: "No date", label: "No date", sortValue: 0 };
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (period === "day") {
    return {
      key: `${year}-${month}-${day}`,
      label: dayFormatter.format(date),
      sortValue: date.getTime(),
    };
  }
  if (period === "month") {
    return {
      key: `${year}-${month}`,
      label: monthFormatter.format(date),
      sortValue: Date.UTC(year, date.getUTCMonth(), 1),
    };
  }
  return {
    key: String(year),
    label: String(year),
    sortValue: Date.UTC(year, 0, 1),
  };
}

export function aggregateEngagementTrend(summaries, period = "week") {
  const buckets = new Map();
  for (const summary of summaries) {
    for (const point of summary.weekly_averages || []) {
      const bucket = periodBucket(point, period);
      const row = buckets.get(bucket.key) || {
        ...bucket,
        attendanceValues: [],
        participationValues: [],
        engagementValues: [],
        activeStudents: 0,
      };
      row.attendanceValues.push(point.average_attendance_rate || 0);
      row.participationValues.push(point.average_participation_rate || 0);
      row.engagementValues.push(point.average_engagement_score || 0);
      row.activeStudents += point.active_students || 0;
      buckets.set(bucket.key, row);
    }
  }
  return [...buckets.values()]
    .sort((first, second) => first.sortValue - second.sortValue || first.key.localeCompare(second.key))
    .map((row) => ({
      key: row.key,
      label: row.label,
      attendance: average(row.attendanceValues),
      participation: average(row.participationValues),
      engagement: average(row.engagementValues),
      activeStudents: row.activeStudents,
    }));
}

export function latestAverageSummary(summaries) {
  const measuredSummaries = summaries.filter(hasAnalyticsData);
  return {
    attendance: average(measuredSummaries.map((summary) => summary.average_attendance_rate)),
    participation: average(measuredSummaries.map((summary) => summary.average_participation_rate)),
    engagement: average(measuredSummaries.map((summary) => summary.average_engagement_score)),
    activeStudents: summaries.reduce((sum, summary) => sum + Number(summary.active_students || 0), 0),
    totalStudents: summaries.reduce((sum, summary) => sum + Number(summary.total_students || 0), 0),
    measuredClasses: measuredSummaries.length,
  };
}
