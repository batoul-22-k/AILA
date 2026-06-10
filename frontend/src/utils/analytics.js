export function average(values) {
  const cleanValues = values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value));
  if (cleanValues.length === 0) return 0;
  return Math.round(cleanValues.reduce((sum, value) => sum + value, 0) / cleanValues.length);
}

export function formatPercent(value) {
  return `${Math.round(Number(value || 0))}%`;
}

export function riskLevel(score) {
  const value = Number(score || 0);
  if (value < 45) return "High";
  if (value < 65) return "Medium";
  return "Low";
}

export function riskReason(row) {
  if (row.week === "No data") return "No engagement context yet";
  if (Number(row.attendance || 0) < 50) return "Low attendance";
  if (Number(row.participation || 0) < 50) return "Low participation";
  if (Number(row.engagement || 0) < 65) return "Engagement below target";
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

export function latestAverageSummary(summaries) {
  return {
    attendance: average(summaries.map((summary) => summary.average_attendance_rate)),
    participation: average(summaries.map((summary) => summary.average_participation_rate)),
    engagement: average(summaries.map((summary) => summary.average_engagement_score)),
    activeStudents: summaries.reduce((sum, summary) => sum + Number(summary.active_students || 0), 0),
    totalStudents: summaries.reduce((sum, summary) => sum + Number(summary.total_students || 0), 0),
  };
}
