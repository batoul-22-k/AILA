export const studentProgress = [
  { label: "Mon", score: 68 },
  { label: "Tue", score: 74 },
  { label: "Wed", score: 71 },
  { label: "Thu", score: 83 },
  { label: "Fri", score: 89 },
];

export const engagementTrend = [
  { label: "Week 1", engagement: 62, responses: 210 },
  { label: "Week 2", engagement: 68, responses: 255 },
  { label: "Week 3", engagement: 73, responses: 318 },
  { label: "Week 4", engagement: 81, responses: 384 },
  { label: "Week 5", engagement: 78, responses: 360 },
];

export const instructorSnapshot = [
  { name: "Dr. Karim", classes: 3, engagement: 84, responseRate: 91, focus: "AI 201" },
  { name: "Prof. Haddad", classes: 2, engagement: 67, responseRate: 72, focus: "Data 310" },
  { name: "Dr. Nasser", classes: 2, engagement: 58, responseRate: 61, focus: "ML Lab" },
  { name: "Prof. Saleh", classes: 4, engagement: 76, responseRate: 83, focus: "Smart Systems" },
];

export const studentRiskRoster = [
  { name: "Nour Ahmad", className: "ML Lab", attendance: 62, engagement: 48, risk: "High", reason: "Missed two live sessions" },
  { name: "Omar Saleh", className: "Data 310", attendance: 74, engagement: 56, risk: "Medium", reason: "Low response confidence" },
  { name: "Lina Farah", className: "AI 201", attendance: 89, engagement: 72, risk: "Low", reason: "Recovered after intervention" },
];

export const activityLogs = [
  { user: "Dr. Karim", category: "academic", details: "Generated a new Bloom taxonomy question set for AI 201." },
  { user: "Nour Ahmad", category: "risk", details: "Triggered an attendance risk signal in ML Lab." },
  { user: "Admin Office", category: "report", details: "Prepared the weekly engagement forecast." },
];

export const answerDistribution = [
  { name: "A", value: 34 },
  { name: "B", value: 18 },
  { name: "C", value: 41 },
  { name: "D", value: 12 },
];

export const weakConcepts = [
  { concept: "Regression", score: 42 },
  { concept: "Data leakage", score: 55 },
  { concept: "Precision", score: 64 },
  { concept: "Recall", score: 71 },
];

export const classComparison = [
  { className: "AI 201", engagement: 84, risk: "Low", instructor: "Dr. Karim" },
  { className: "Data 310", engagement: 67, risk: "Medium", instructor: "Prof. Haddad" },
  { className: "ML Lab", engagement: 51, risk: "High", instructor: "Dr. Nasser" },
  { className: "Smart Systems", engagement: 76, risk: "Low", instructor: "Prof. Saleh" },
];

export const riskReports = [
  { title: "ML Lab participation drop", level: "High", detail: "Response rate decreased 18% over two weeks." },
  { title: "Data 310 quiz gaps", level: "Medium", detail: "Students missed core classification concepts." },
  { title: "AI 201 stable growth", level: "Low", detail: "Engagement and completion remain above target." },
];

export const heatmapRows = [
  ["AI 201", 85, 78, 91, 88],
  ["Data 310", 62, 69, 73, 58],
  ["ML Lab", 49, 55, 61, 52],
  ["Smart Systems", 72, 81, 79, 84],
];
