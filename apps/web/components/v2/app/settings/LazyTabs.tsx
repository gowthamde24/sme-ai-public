"use client";

import dynamic from "next/dynamic";

/**
 * Settings, one tab at a time (job DQ): the forms of each tab are a chunk of their own, so the route's first load carries none of them (the route-JS budget counts that) and a tab's script comes only when that tab is open.
 * Drawn on the server like the rest and live when the chunk arrives.
 */
export const PlanMoves = dynamic(() => import("../plan/PlanMoves").then((m) => m.PlanMoves));
export const CalendarFeed = dynamic(() => import("../data/CalendarFeed").then((m) => m.CalendarFeed));
export const DataExport = dynamic(() => import("../data/DataExport").then((m) => m.DataExport));
export const DataImport = dynamic(() => import("../data/DataImport").then((m) => m.DataImport));
export const DeleteData = dynamic(() => import("../privacy/DeleteData").then((m) => m.DeleteData));
export const ExportMyData = dynamic(() => import("../privacy/ExportMyData").then((m) => m.ExportMyData));
export const MarketingSwitch = dynamic(() => import("../privacy/MarketingSwitch").then((m) => m.MarketingSwitch));
export const GrievanceForm = dynamic(() => import("../privacy/GrievanceForm").then((m) => m.GrievanceForm));
export const GstinForm = dynamic(() => import("../gstin/GstinForm").then((m) => m.GstinForm));
export const SendingForm = dynamic(() => import("../agent-settings/AgentSettingsForms").then((m) => m.SendingForm));
export const QuietHoursForm = dynamic(() => import("../agent-settings/AgentSettingsForms").then((m) => m.QuietHoursForm));
export const RemindersForm = dynamic(() => import("../agent-settings/AgentSettingsForms").then((m) => m.RemindersForm));
