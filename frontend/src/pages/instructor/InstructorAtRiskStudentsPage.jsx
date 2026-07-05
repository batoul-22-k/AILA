import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  CheckCircle2,
  Eye,
  Info,
  Minus,
  RefreshCw,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getClassPredictionSummary, listClasses, runPredictionAnalysis } from "../../api/client";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { DashboardCard } from "../../components/DashboardCard";
import { EmptyState } from "../../components/EmptyState";
import { Modal } from "../../components/Modal";
import { PageHeader } from "../../components/PageHeader";
import { TableHeaderFilter, TableToolbar } from "../../components/table";
import { cn } from "../../utils/cn";

const riskOrder = { high: 3, medium: 2, low: 1 };
const BLOOM_MASTERY_THRESHOLD = 60;
const BLOOM_GAP_TOOLTIP = "Only Bloom levels with answered questions are evaluated. Untested levels are not counted as mastery gaps.";
const bloomLevelOrder = ["remember", "understand", "apply", "analyze", "evaluate", "create"];
const bloomLevelLabels = {
  remember: "Remember",
  understand: "Understand",
  apply: "Apply",
  analyze: "Analyze",
  evaluate: "Evaluate",
  create: "Create",
};
const trendFilterLabels = {
  worsened: "Worsened",
  improved: "Improved",
  stable: "Stable",
  initial: "Initial Prediction",
};
const factorDisplayLabels = {
  Attendance: "Low attendance",
  "Attendance Rate": "Low attendance",
  Participation: "Low participation",
  "Participation Rate": "Low participation",
  "Answer Rate": "Low participation",
  Correctness: "Low correctness",
  "Correctness Rate": "Low correctness",
  "Semantic Score": "Weak short-answer quality",
  Engagement: "Low engagement",
  "Engagement Score": "Low engagement",
  "Engagement Trend": "Declining engagement",
  Consistency: "Inconsistent activity",
  "Consistency Score": "Inconsistent activity",
  "Response Time": "Slow response behavior",
  "Recent Activity": "Recent inactivity",
  "Recent Activity Count": "Recent inactivity",
  "Weak Concepts": "Weak Bloom mastery",
  "Weak Concepts Count": "Multiple weak concepts",
  "Bloom Mastery Gaps": "Weak Bloom mastery",
};

function riskTone(level) {
  if (String(level).toLowerCase() === "high") return "red";
  if (String(level).toLowerCase() === "medium") return "gold";
  return "green";
}

function riskLabel(level) {
  const clean = String(level || "low").toLowerCase();
  if (clean === "high") return "High";
  if (clean === "medium") return "Medium";
  return "Low";
}

function riskBadgeLabel(level) {
  return `${riskLabel(level)} Risk`;
}

function probabilityPercent(value, fallback = "-") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return `${Math.round(numeric > 0 && numeric <= 1 ? numeric * 100 : numeric)}%`;
}

function signalPercent(value, fallback = "Pending") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return `${Math.round(numeric > 0 && numeric <= 1 ? numeric * 100 : numeric)}%`;
}

function shortDate(value) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function titleCase(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function normalizedFactorName(value) {
  return titleCase(value?.factor || value?.feature || value?.name || value?.label || value);
}

function factorLabel(value) {
  const label = normalizedFactorName(value);
  return factorDisplayLabels[label] || label;
}

function factorImpact(value) {
  const numeric = Number(value?.impact ?? value?.importance ?? value?.weight);
  return Number.isFinite(numeric) ? Math.abs(numeric) : null;
}

function bloomLabel(value) {
  const clean = String(value || "").trim().toLowerCase();
  return bloomLevelLabels[clean] || titleCase(value);
}

function bloomRank(value) {
  const index = bloomLevelOrder.indexOf(String(value || "").trim().toLowerCase());
  return index === -1 ? bloomLevelOrder.length : index;
}

function bloomKey(value) {
  const clean = String(value || "").trim().toLowerCase();
  const labelMatch = Object.entries(bloomLevelLabels).find(([, label]) => label.toLowerCase() === clean);
  return labelMatch?.[0] || clean;
}

function mapValueForBloomLevel(map, levelKey) {
  if (!map || typeof map !== "object") return null;
  const label = bloomLevelLabels[levelKey];
  if (map[levelKey] !== undefined) return map[levelKey];
  if (map[label] !== undefined) return map[label];
  const entry = Object.entries(map).find(([key]) => bloomKey(key) === levelKey);
  return entry ? entry[1] : null;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function masteryPercent(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function signalPercentNumber(value) {
  const numeric = numberOrNull(value);
  if (numeric === null) return null;
  return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function rawSignalNumber(value) {
  const numeric = numberOrNull(value);
  return numeric === null ? null : numeric;
}

function bloomMasteryRowsForPrediction(prediction) {
  const features = prediction?.features || {};
  const source = prediction?.bloom_mastery_by_level || features.bloom_mastery_by_level || {};
  const sourceRows = Array.isArray(source) ? source : Object.values(source || {});
  const answerCounts = features.concept_answer_counts || {};
  const correctCounts = features.concept_correct_answer_counts || {};
  const correctnessMap = features.concept_correctness_map || {};

  return bloomLevelOrder.map((levelKey) => {
    const row = sourceRows.find((item) => bloomKey(item?.bloom_level || item?.level || item?.concept) === levelKey) || {};
    const attemptedValue = numberOrNull(
      row.attempted_count
      ?? row.questions_answered
      ?? mapValueForBloomLevel(answerCounts, levelKey),
    );
    const correctValue = numberOrNull(
      row.correct_count
      ?? row.correct_answers
      ?? mapValueForBloomLevel(correctCounts, levelKey),
    );
    const attempted = attemptedValue || 0;
    const correct = correctValue || 0;
    const mappedMastery = masteryPercent(mapValueForBloomLevel(correctnessMap, levelKey));
    const mastery = attempted > 0
      ? correctValue !== null
        ? (correct / attempted) * 100
        : mappedMastery ?? masteryPercent(row.mastery_rate ?? row.average_correctness)
      : null;
    return {
      level: levelKey,
      label: bloomLevelLabels[levelKey],
      attempted_count: attempted,
      correct_count: correct,
      mastery_rate: mastery,
      is_gap: attempted > 0 && mastery !== null && mastery < BLOOM_MASTERY_THRESHOLD,
    };
  });
}

function bloomGapRowsForPrediction(prediction) {
  return bloomMasteryRowsForPrediction(prediction).filter((row) => row.is_gap);
}

function notAssessedBloomRowsForPrediction(prediction) {
  return bloomMasteryRowsForPrediction(prediction).filter((row) => row.attempted_count <= 0);
}

function bloomLevelsForPrediction(prediction) {
  return bloomGapRowsForPrediction(prediction).map((row) => row.label);
}

function studentSignalValue(prediction, keys) {
  const features = prediction?.features || {};
  for (const key of keys) {
    if (prediction?.[key] !== null && prediction?.[key] !== undefined && prediction?.[key] !== "") return prediction[key];
    if (features[key] !== null && features[key] !== undefined && features[key] !== "") return features[key];
  }
  return null;
}

function hasRiskLevel(value) {
  return ["low", "medium", "high"].includes(String(value?.risk_level || value?.riskLevel || "").toLowerCase());
}

function predictionDate(prediction) {
  return prediction?.generated_at || prediction?.predicted_at || prediction?.last_prediction || prediction?.prediction_timestamp;
}

function riskScore(prediction) {
  const numeric = Number(prediction?.risk_score ?? prediction?.riskScore ?? prediction?.risk_probability);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function predictionHistoryRows(row, summary) {
  const directArrays = [row?.prediction_history, row?.history, row?.previous_predictions].filter(Array.isArray);
  const summaryHistory = Array.isArray(summary?.prediction_history)
    ? summary.prediction_history.filter((item) => item.student_id === row.student_id && (!item.class_id || item.class_id === (row.class_id || summary.class_id)))
    : [];
  return [...directArrays.flat(), ...summaryHistory].filter(hasRiskLevel);
}

function previousPredictionFor(row, summary) {
  const objectCandidates = [
    row?.previous_prediction,
    row?.previousPrediction,
    row?.previous,
    row?.previous_result,
    row?.prior_prediction,
    row?.priorPrediction,
  ].filter(hasRiskLevel);
  if (objectCandidates.length) return objectCandidates[0];

  const previousLevel = row?.previous_risk_level ?? row?.previousRiskLevel ?? row?.prior_risk_level;
  if (previousLevel) {
    return {
      risk_level: previousLevel,
      risk_score: row?.previous_risk_score ?? row?.previousRiskScore ?? row?.prior_risk_score,
      generated_at: row?.previous_generated_at ?? row?.previous_predicted_at ?? row?.prior_generated_at,
      confidence: row?.previous_confidence ?? row?.previous_model_confidence,
    };
  }

  const currentDate = new Date(predictionDate(row) || summary?.generated_at || 0).getTime();
  const rows = predictionHistoryRows(row, summary)
    .filter((item) => item.prediction_id !== row.prediction_id)
    .sort((first, second) => new Date(predictionDate(second) || 0).getTime() - new Date(predictionDate(first) || 0).getTime());

  if (!rows.length) return null;
  if (!Number.isFinite(currentDate) || currentDate <= 0) return rows[0];
  return rows.find((item) => {
    const itemDate = new Date(predictionDate(item) || 0).getTime();
    return Number.isFinite(itemDate) && itemDate < currentDate;
  }) || null;
}

function trendForPrediction(prediction) {
  const serverTrend = prediction.prediction_trend;
  const previous = prediction.previous_prediction;
  if (serverTrend?.status === "initial" || !hasRiskLevel(previous)) {
    return {
      kind: "initial",
      label: "Initial Prediction",
      tone: "slate",
      Icon: ArrowRight,
      title: `Current prediction: ${riskBadgeLabel(prediction.risk_level)} (${shortDate(prediction.last_prediction)})`,
    };
  }

  const previousRisk = String(previous.risk_level || previous.riskLevel || "").toLowerCase();
  const currentRisk = String(prediction.risk_level || "").toLowerCase();
  const delta = (riskOrder[currentRisk] || 0) - (riskOrder[previousRisk] || 0);
  const previousScore = riskScore(previous);
  const currentScore = riskScore(prediction);
  const serverScoreDelta = Number(serverTrend?.risk_score_difference);
  const scoreDelta = Number.isFinite(serverScoreDelta)
    ? serverScoreDelta
    : previousScore !== null && currentScore !== null
      ? currentScore - previousScore
      : null;
  const scoreLine = scoreDelta === null ? "Risk score difference unavailable" : `Risk score ${scoreDelta >= 0 ? "+" : ""}${Math.round(scoreDelta)} pts`;
  const confidence = probabilityPercent(prediction.confidence ?? prediction.model_confidence, "Pending");
  const previousDate = serverTrend?.previous_prediction_date || predictionDate(previous);
  const currentDate = serverTrend?.current_prediction_date || prediction.last_prediction;
  const statusLabel = delta > 0 ? "Worsened" : delta < 0 ? "Improved" : "Stable";
  const title = `${riskLabel(previousRisk)} (${shortDate(previousDate)})\n${statusLabel}\n${riskLabel(currentRisk)} (${shortDate(currentDate)})\n${scoreLine}\nConfidence ${confidence}`;

  if (delta > 0) {
    return {
      kind: "worsened",
      label: "Worsened",
      tone: "red",
      Icon: ArrowUpRight,
      title,
    };
  }
  if (delta < 0) {
    return {
      kind: "improved",
      label: "Improved",
      tone: "green",
      Icon: ArrowDownRight,
      title,
    };
  }
  return { kind: "stable", label: "Stable", tone: "slate", Icon: Minus, title };
}

function predictionSummary(prediction) {
  const drivers = topRiskDrivers(prediction);
  if (drivers.length) {
    return `${prediction?.student_name || "This student"} is classified as ${riskBadgeLabel(prediction?.risk_level)}. Main risk drivers: ${drivers.join(", ")}.`;
  }
  if (prediction?.explanation?.summary) return prediction.explanation.summary;
  return `${prediction?.student_name || "This student"} is classified as ${riskBadgeLabel(prediction?.risk_level)}.`;
}

function classNameFor(classesById, classId) {
  return classesById.get(classId)?.name || classesById.get(classId)?.class_name || classId || "Class";
}

function normalizePrediction(row, summary, classesById) {
  return {
    ...row,
    id: row.prediction_id || `${row.class_id || summary.class_id}-${row.student_id}`,
    class_name: row.class_name || classNameFor(classesById, row.class_id || summary.class_id),
    class_id: row.class_id || summary.class_id,
    last_prediction: row.generated_at || row.predicted_at || summary.generated_at,
    previous_prediction: previousPredictionFor(row, summary),
  };
}

function predictionRowsForSummary(summary, classesById) {
  const rows = summary.student_reports?.length
    ? summary.student_reports
    : summary.predictions?.length
      ? summary.predictions
      : summary.at_risk_students || [];
  return rows.map((row) => normalizePrediction(row, summary, classesById));
}

function sortPredictions(rows) {
  return [...rows].sort((first, second) => {
    const riskDelta = (riskOrder[String(second.risk_level || "").toLowerCase()] || 0) - (riskOrder[String(first.risk_level || "").toLowerCase()] || 0);
    if (riskDelta) return riskDelta;
    return Number(second.confidence || second.model_confidence || 0) - Number(first.confidence || first.model_confidence || 0);
  });
}

function learningConcernFallback(prediction) {
  return studentRiskDriverCandidates(prediction).map((item) => item.label);
}

function xaiDriverImpacts(prediction) {
  const explanation = prediction?.explanation || {};
  const rows = [
    ...(Array.isArray(explanation.negative_factors) ? explanation.negative_factors : []),
    ...(Array.isArray(explanation.top_factors) ? explanation.top_factors.filter((factor) => factor?.direction !== "positive") : []),
    ...(Array.isArray(prediction?.feature_importance) ? prediction.feature_importance.filter((factor) => factor?.direction !== "positive") : []),
  ];
  const impacts = new Map();
  rows.forEach((factor) => {
    const label = factorLabel(factor);
    const impact = factorImpact(factor);
    if (!label || impact === null) return;
    impacts.set(label, Math.max(impacts.get(label) || 0, impact));
  });
  return impacts;
}

function addDriverCandidate(candidates, impacts, maxImpact, label, severity) {
  if (!Number.isFinite(severity) || severity <= 0) return;
  const impact = impacts.get(label) || 0;
  const xaiScore = maxImpact > 0 ? (impact / maxImpact) * 25 : 0;
  candidates.push({ label, score: severity + xaiScore, impact });
}

function studentRiskDriverCandidates(prediction) {
  const impacts = xaiDriverImpacts(prediction);
  const maxImpact = Math.max(...impacts.values(), 0);
  const candidates = [];
  const metricThreshold = 60;
  const attendance = signalPercentNumber(studentSignalValue(prediction, ["attendance", "attendance_rate"]));
  const participation = signalPercentNumber(studentSignalValue(prediction, ["participation", "participation_rate", "answer_rate"]));
  const correctness = signalPercentNumber(studentSignalValue(prediction, ["correctness", "correctness_rate"]));
  const semanticScore = signalPercentNumber(studentSignalValue(prediction, ["semantic_score", "average_semantic_score"]));
  const engagement = signalPercentNumber(studentSignalValue(prediction, ["engagement", "engagement_score", "engagement_index", "derived_engagement_index"]));
  const consistency = signalPercentNumber(studentSignalValue(prediction, ["consistency_score", "response_consistency"]));
  const recentActivity = rawSignalNumber(studentSignalValue(prediction, ["recent_activity_count", "activity_last_7_days"]));
  const responseTime = rawSignalNumber(studentSignalValue(prediction, ["response_time", "average_response_time"]));
  const weakConceptsCount = rawSignalNumber(studentSignalValue(prediction, ["weak_concepts_count"]));
  const bloomRows = bloomMasteryRowsForPrediction(prediction);
  const assessedBloomRows = bloomRows.filter((row) => row.attempted_count > 0);
  const bloomGaps = bloomRows.filter((row) => row.is_gap);

  addDriverCandidate(candidates, impacts, maxImpact, "Low attendance", attendance === null ? 0 : metricThreshold - attendance);
  addDriverCandidate(candidates, impacts, maxImpact, "Low correctness", correctness === null ? 0 : metricThreshold - correctness);
  addDriverCandidate(candidates, impacts, maxImpact, "Weak short-answer quality", semanticScore === null ? 0 : metricThreshold - semanticScore);
  addDriverCandidate(candidates, impacts, maxImpact, "Low participation", participation === null ? 0 : metricThreshold - participation);
  addDriverCandidate(candidates, impacts, maxImpact, "Low engagement", engagement === null ? 0 : metricThreshold - engagement);
  addDriverCandidate(candidates, impacts, maxImpact, "Inconsistent activity", consistency === null ? 0 : metricThreshold - consistency);
  addDriverCandidate(candidates, impacts, maxImpact, "Recent inactivity", recentActivity !== null && recentActivity <= 0 ? 35 : 0);
  addDriverCandidate(candidates, impacts, maxImpact, "Slow response behavior", responseTime !== null && responseTime > 90 ? Math.min(40, ((responseTime - 90) / 90) * 40) : 0);
  if (assessedBloomRows.length > 0 && bloomGaps.length > 0) {
    const bloomSeverity = Math.min(
      60,
      bloomGaps.reduce((total, row) => total + Math.max(0, BLOOM_MASTERY_THRESHOLD - Number(row.mastery_rate || 0)), 0) / bloomGaps.length
        + (bloomGaps.length * 8),
    );
    addDriverCandidate(candidates, impacts, maxImpact, "Weak Bloom mastery", bloomSeverity);
  } else if (weakConceptsCount !== null && weakConceptsCount > 0) {
    addDriverCandidate(candidates, impacts, maxImpact, "Multiple weak concepts", Math.min(weakConceptsCount * 12, 48));
  }

  return candidates
    .filter((row) => row.score > 0)
    .sort((first, second) => second.score - first.score || second.impact - first.impact || first.label.localeCompare(second.label));
}

function topRiskDrivers(prediction) {
  return [...new Set(learningConcernFallback(prediction))].slice(0, 3);
}

function RiskBadge({ level, className }) {
  const clean = String(level || "").toLowerCase();
  const Icon = clean === "low" ? CheckCircle2 : AlertTriangle;
  return (
    <Badge tone={riskTone(level)} className={cn("px-3 py-1.5 text-sm font-black", className)}>
      <Icon size={15} />
      {riskBadgeLabel(level)}
    </Badge>
  );
}

function TrendBadge({ prediction }) {
  const trend = trendForPrediction(prediction);
  const TrendIcon = trend.Icon;
  const previous = prediction.previous_prediction;
  return (
    <span className="group relative inline-flex w-fit">
      <Badge
        tone={trend.tone}
        className={cn(
          "px-3 py-1.5 font-black transition duration-200 group-hover:-translate-y-0.5",
          trend.kind === "worsened" && "ring-1 ring-red-200 dark:ring-red-400/20",
          trend.kind === "improved" && "ring-1 ring-emerald-200 dark:ring-emerald-400/20",
        )}
      >
        <TrendIcon size={14} />
        {hasRiskLevel(previous) ? `${riskLabel(previous.risk_level)} -> ${riskLabel(prediction.risk_level)}` : trend.label}
        {hasRiskLevel(previous) && <span className="font-black">({trend.label})</span>}
      </Badge>
      <span className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-30 w-64 translate-y-1 whitespace-pre-line rounded-lg border border-role-border bg-white p-3 text-xs font-semibold leading-5 text-slate-600 opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        {trend.title}
      </span>
    </span>
  );
}

function CompactTrendPill({ prediction }) {
  const trend = trendForPrediction(prediction);
  const TrendIcon = trend.Icon;
  const previous = prediction.previous_prediction;
  const label = hasRiskLevel(previous)
    ? `${riskLabel(previous.risk_level)} → ${riskLabel(prediction.risk_level)} · ${trend.label}`
    : trend.label;
  return (
    <span className="group relative inline-flex max-w-full">
      <Badge
        tone={trend.tone}
        className={cn(
          "max-w-full px-2.5 py-1 text-xs font-black transition duration-200 group-hover:-translate-y-0.5",
          trend.kind === "worsened" && "ring-1 ring-red-200 dark:ring-red-400/20",
          trend.kind === "improved" && "ring-1 ring-emerald-200 dark:ring-emerald-400/20",
        )}
      >
        <TrendIcon size={13} className="shrink-0" />
        <span className="truncate">{label}</span>
      </Badge>
      <span className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-30 w-64 translate-y-1 whitespace-pre-line rounded-lg border border-role-border bg-white p-3 text-xs font-semibold leading-5 text-slate-600 opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        {trend.title}
      </span>
    </span>
  );
}

function CompactRiskDrivers({ prediction }) {
  const drivers = topRiskDrivers(prediction);
  return (
    <div className="min-h-[2.5rem] text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
      {drivers.length ? drivers.map((driver, index) => (
        <span key={driver} className="inline">
          {index > 0 && <span className="px-1.5 text-slate-300 dark:text-slate-600">•</span>}
          <span>{driver}</span>
        </span>
      )) : (
        <span className="text-slate-500 dark:text-slate-400">No detailed drivers</span>
      )}
    </div>
  );
}

function StudentRiskCard({ prediction, onView }) {
  return (
    <article className="flex min-h-[196px] flex-col justify-between rounded-lg border border-role-border bg-white p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="grid gap-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-black text-slate-950 dark:text-white" title={prediction.student_name || prediction.student_id}>
              {prediction.student_name || prediction.student_id || "Student"}
            </h3>
          </div>
          <RiskBadge level={prediction.risk_level} className="shrink-0 px-2.5 py-1 text-xs" />
        </div>

        <p className="truncate text-xs font-bold text-slate-500 dark:text-slate-400" title={prediction.class_name || ""}>
          {prediction.class_name || "Class"}
        </p>

        <CompactTrendPill prediction={prediction} />

        <CompactRiskDrivers prediction={prediction} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-role-border pt-3 dark:border-slate-800">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
          Confidence {probabilityPercent(prediction.confidence ?? prediction.model_confidence)}
        </span>
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-role-border text-slate-500 transition hover:border-role-primary hover:text-role-primary focus:outline-none focus:ring-2 focus:ring-role-primary/30 dark:border-slate-800 dark:text-slate-400"
          onClick={() => onView(prediction)}
          aria-label={`View ${prediction.student_name || "student"} profile`}
          title="View profile"
        >
          <Eye size={15} />
        </button>
      </div>
    </article>
  );
}

function PredictionExplanationModal({ prediction, onClose }) {
  const drivers = prediction ? topRiskDrivers(prediction) : [];
  const bloomRows = bloomMasteryRowsForPrediction(prediction);
  const assessedBloomRows = bloomRows.filter((row) => row.attempted_count > 0);
  const bloomGapRows = bloomGapRowsForPrediction(prediction);
  const notAssessedBloomRows = notAssessedBloomRowsForPrediction(prediction);
  const actions = (prediction?.recommended_actions || prediction?.recommendations || []).slice(0, 4);
  const signals = [
    ["Attendance", studentSignalValue(prediction, ["attendance", "attendance_rate"])],
    ["Participation", studentSignalValue(prediction, ["participation", "participation_rate", "answer_rate"])],
    ["Correctness", studentSignalValue(prediction, ["correctness", "correctness_rate"])],
    ["Engagement", studentSignalValue(prediction, ["engagement", "engagement_score", "engagement_index"])],
    ["Semantic Score", studentSignalValue(prediction, ["semantic_score", "average_semantic_score"])],
  ];

  return (
    <Modal open={Boolean(prediction)} title="Student Prediction Profile" onClose={onClose} panelClassName="max-w-3xl">
      {prediction && (
        <div className="grid gap-4">
          <section className="rounded-lg border border-role-border p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-950 dark:text-white">{prediction.student_name || "Student"}</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{prediction.class_name}</p>
              </div>
              <RiskBadge level={prediction.risk_level} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <TrendBadge prediction={prediction} />
              <Badge tone="slate" className="px-3 py-1.5 font-black">
                <Target size={14} />
                Confidence {probabilityPercent(prediction.confidence ?? prediction.model_confidence)}
              </Badge>
              <Badge tone="slate" className="px-3 py-1.5 font-black">
                Prediction Date {shortDate(prediction.last_prediction || prediction.generated_at || prediction.predicted_at)}
              </Badge>
            </div>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">{predictionSummary(prediction)}</p>
          </section>

          <section className="rounded-lg border border-role-border p-4 dark:border-slate-800">
            <h4 className="text-sm font-black text-slate-950 dark:text-white">Feature Summary</h4>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {signals.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-lg bg-role-hover px-3 py-2 dark:bg-slate-950/40">
                  <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
                  <span className="font-black text-slate-950 dark:text-white">{signalPercent(value)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-role-border p-4 dark:border-slate-800">
            <h4 className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
              <BrainCircuit size={17} className="text-role-primary" />
              Main Risk Drivers
            </h4>
            <div className="mt-3 grid gap-2">
              {drivers.length ? drivers.map((driver) => (
                <div key={driver} className="flex items-center gap-2 rounded-lg bg-role-hover px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-slate-950/40 dark:text-slate-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-role-primary" />
                  {driver}
                </div>
              )) : <p className="rounded-lg bg-role-hover px-3 py-2 text-sm font-semibold text-slate-500 dark:bg-slate-950/40">No risk driver detail available.</p>}
            </div>
          </section>

          <section className="rounded-lg border border-role-border p-4 dark:border-slate-800">
            <h4 className="flex items-center gap-2 text-sm font-black text-slate-950 dark:text-white">
              {assessedBloomRows.length ? "Bloom-Level Mastery Gaps" : "Bloom Assessment"}
              <span className="group relative inline-flex">
                <Info size={14} className="text-role-primary" />
                <span className="pointer-events-none absolute left-0 top-[calc(100%+0.5rem)] z-40 w-72 translate-y-1 rounded-lg border border-role-border bg-white p-3 text-xs font-semibold leading-5 text-slate-600 opacity-0 shadow-lift transition group-hover:translate-y-0 group-hover:opacity-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {BLOOM_GAP_TOOLTIP}
                </span>
              </span>
            </h4>
            {assessedBloomRows.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {bloomGapRows.length ? bloomGapRows.map((row) => (
                  <Badge key={row.level} tone="slate">
                    {bloomLabel(row.label)} {Math.round(row.mastery_rate)}%
                  </Badge>
                )) : <span className="text-sm font-semibold text-slate-500">No assessed Bloom level is below mastery.</span>}
              </div>
            ) : (
              <p className="mt-3 text-sm font-semibold text-slate-500">No Bloom-level questions have been completed yet.</p>
            )}
            {assessedBloomRows.length > 0 && notAssessedBloomRows.length > 0 && (
              <div className="mt-4 border-t border-role-border pt-3 dark:border-slate-800">
                <p className="text-xs font-black uppercase tracking-wide text-slate-400">Not yet assessed</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {notAssessedBloomRows.map((row) => (
                    <Badge key={row.level} tone="slate" className="opacity-60">{row.label}</Badge>
                  ))}
                </div>
              </div>
            )}
          </section>

          
        </div>
      )}
    </Modal>
  );
}

export function InstructorAtRiskStudentsPage() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [summaries, setSummaries] = useState([]);
  const [selectedPrediction, setSelectedPrediction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [trendFilter, setTrendFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");

  const classesById = useMemo(() => new Map(classes.map((row) => [row.class_id, row])), [classes]);

  const allPredictions = useMemo(() => {
    const rows = summaries.flatMap((summary) => predictionRowsForSummary(summary, classesById));
    return sortPredictions(rows);
  }, [classesById, summaries]);
  const predictions = useMemo(
    () => allPredictions.filter((prediction) => ["medium", "high"].includes(String(prediction.risk_level || "").toLowerCase())),
    [allPredictions],
  );
  const driverOptions = useMemo(() => {
    return [...new Set(predictions.flatMap((prediction) => topRiskDrivers(prediction)))].sort();
  }, [predictions]);
  const filteredPredictions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return predictions.filter((prediction) => {
      const drivers = topRiskDrivers(prediction);
      const trend = trendForPrediction(prediction);
      const matchesSearch = !query || [prediction.student_name, prediction.class_name, prediction.student_id].some((value) => String(value || "").toLowerCase().includes(query));
      return matchesSearch
        && (!riskFilter || riskLabel(prediction.risk_level) === riskFilter)
        && (!trendFilter || trend.kind === trendFilter)
        && (!driverFilter || drivers.includes(driverFilter));
    });
  }, [driverFilter, predictions, riskFilter, search, trendFilter]);
  const riskDistribution = useMemo(() => (
    allPredictions.reduce((counts, prediction) => {
      const level = String(prediction.risk_level || "low").toLowerCase();
      if (level === "high" || level === "medium" || level === "low") counts[level] += 1;
      return counts;
    }, { low: 0, medium: 0, high: 0 })
  ), [allPredictions]);

  async function loadPage(nextClassId = classId) {
    setLoading(true);
    setError("");
    try {
      const classRows = await listClasses();
      setClasses(classRows);
      const classIds = nextClassId ? [nextClassId] : classRows.map((row) => row.class_id).filter(Boolean);
      const summaryRows = await Promise.all(classIds.map((id) => getClassPredictionSummary(id).catch(() => ({ class_id: id, at_risk_students: [], empty: true }))));
      setClassId(nextClassId || "");
      setSummaries(summaryRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load classroom support insights");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage("");
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    setError("");
    try {
      const targetClassIds = classId ? [classId] : classes.map((row) => row.class_id).filter(Boolean);
      await Promise.all(targetClassIds.map((id) => runPredictionAnalysis(id).catch(() => null)));
      await loadPage(classId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh classroom support insights");
    } finally {
      setRefreshing(false);
    }
  }

  function handleClassFilter(event) {
    void loadPage(event.target.value);
  }

  function clearCardFilters() {
    setSearch("");
    setRiskFilter("");
    setTrendFilter("");
    setDriverFilter("");
  }

  return (
    <div className="page-grid gap-6">
      <PageHeader
        title="At-Risk Students"
                tone="role"
        action={(
          <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
            <select
              className="adaptive-input h-10 w-full rounded-lg border border-role-border bg-white px-3 text-sm font-semibold dark:border-slate-800 dark:bg-slate-900 sm:w-56"
              value={classId}
              onChange={handleClassFilter}
              aria-label="Class filter"
            >
              <option value="">All Classes</option>
              {classes.map((classDoc) => (
                <option key={classDoc.class_id} value={classDoc.class_id}>{classDoc.name}</option>
              ))}
            </select>
            <Button type="button" variant="role" loading={refreshing} onClick={handleRefresh} className="h-10">
              <RefreshCw size={17} />
              Refresh
            </Button>
          </div>
        )}
      />

      {error && <DashboardCard className="p-4"><p className="text-sm font-semibold text-red-600">{error}</p></DashboardCard>}

      {!loading && classes.length > 0 && (
        <DashboardCard className="border-l-4 border-l-red-500 p-5 shadow-sm">
          <p className="text-sm font-black text-slate-600 dark:text-slate-300">Students Requiring Support</p>
          <p className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{predictions.length}</p>
        </DashboardCard>
      )}

      {loading && <DashboardCard className="p-5"><p className="text-sm font-semibold text-slate-500">Loading support insights...</p></DashboardCard>}

      {!loading && classes.length === 0 && (
        <EmptyState title="No assigned classes" description="Classroom support insights appear after classes are assigned to you." />
      )}

      {!loading && classes.length > 0 && (
        <DashboardCard className="p-4 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-role-primary">AI Decision Support</p>
              <h2 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Students Requiring Support</h2>
            </div>
            <Badge tone="slate">{filteredPredictions.length} monitored</Badge>
          </div>

          <div className="mt-4">
            <TableToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search students"
              filters={[
                { key: "risk", label: "Risk", valueLabel: riskFilter, onClear: () => setRiskFilter("") },
                { key: "trend", label: "Trend", valueLabel: trendFilterLabels[trendFilter] || "", onClear: () => setTrendFilter("") },
                { key: "driver", label: "Driver", valueLabel: driverFilter, onClear: () => setDriverFilter("") },
              ]}
              onClearFilters={clearCardFilters}
            >
              <TableHeaderFilter
                label="Risk"
                value={riskFilter}
                onChange={setRiskFilter}
                allLabel="All risk"
                options={[
                  { value: "High", label: "High" },
                  { value: "Medium", label: "Medium" },
                ]}
              />
              <TableHeaderFilter
                label="Trend"
                value={trendFilter}
                onChange={setTrendFilter}
                allLabel="All trends"
                options={[
                  { value: "worsened", label: "Worsened" },
                  { value: "improved", label: "Improved" },
                  { value: "stable", label: "Stable" },
                  { value: "initial", label: "Initial Prediction" },
                ]}
              />
              <TableHeaderFilter
                label="Driver"
                value={driverFilter}
                onChange={setDriverFilter}
                allLabel="All drivers"
                align="right"
                options={driverOptions.map((driver) => ({ value: driver, label: driver }))}
              />
            </TableToolbar>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["high", "High Risk", riskDistribution.high],
              ["medium", "Medium Risk", riskDistribution.medium],
              ["low", "Low Risk", riskDistribution.low],
            ].map(([key, label, value]) => (
              <div key={key} className="rounded-lg bg-role-hover p-3 dark:bg-slate-950/40">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    key === "high" && "bg-red-500",
                    key === "medium" && "bg-amber-500",
                    key === "low" && "bg-emerald-500",
                  )}
                  />
                  <span className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</span>
                </div>
                <p className="mt-1 text-xl font-black text-slate-950 dark:text-white">{value}</p>
              </div>
            ))}
          </div>

          {filteredPredictions.length === 0 ? (
            <div className="mt-4 rounded-lg border border-role-border bg-role-hover/60 p-5 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/30">
              No students match the current support filters.
            </div>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredPredictions.map((prediction) => (
                <StudentRiskCard key={prediction.id} prediction={prediction} onView={setSelectedPrediction} />
              ))}
            </div>
          )}
        </DashboardCard>
      )}

      <PredictionExplanationModal prediction={selectedPrediction} onClose={() => setSelectedPrediction(null)} />
    </div>
  );
}
