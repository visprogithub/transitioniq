"use client";

import { AlertTriangle, Info, ShieldCheck } from "lucide-react";

interface SafetyDisclaimerProps {
  variant?: "banner" | "inline" | "footer";
}

export function SafetyDisclaimer({ variant = "banner" }: SafetyDisclaimerProps) {
  if (variant === "footer") {
    return (
      <div className="mt-8 p-4 bg-gray-50 border-t border-gray-200">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4" />
            <span className="font-medium">Important Safety Information</span>
          </div>
          <p>
            TransitionIQ is a clinical decision support tool designed to assist
            healthcare professionals. It does <strong>not</strong> replace
            professional medical judgment. All discharge decisions must be made
            by qualified healthcare providers who have directly evaluated the
            patient.
          </p>
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p>
          This assessment is for clinical decision support only. Final discharge
          decisions require physician review and patient evaluation.
        </p>
      </div>
    );
  }

  // Default: banner
  return (
    <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-center gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        <div className="text-sm">
          <span className="font-semibold">Clinical Decision Support Tool</span>
          <span className="mx-2">|</span>
          <span>
            This AI-powered assessment assists but does not replace professional
            medical judgment. All recommendations require physician verification.
          </span>
        </div>
      </div>
    </div>
  );
}

export function MedicalCaveats() {
  return (
    <div className="space-y-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
      <h3 className="font-semibold text-blue-900 flex items-center gap-2">
        <ShieldCheck className="w-5 h-5" />
        Important Medical Caveats
      </h3>
      <ul className="text-sm text-blue-800 space-y-2">
        <li className="flex items-start gap-2">
          <span className="text-blue-500 mt-1">•</span>
          <span>
            <strong>Not a substitute for clinical judgment:</strong> This tool
            provides AI-assisted risk assessment to support, not replace,
            physician decision-making.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-blue-500 mt-1">•</span>
          <span>
            <strong>Data limitations:</strong> Assessments are based on
            available EHR data and may not capture all relevant clinical
            factors.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-blue-500 mt-1">•</span>
          <span>
            <strong>Drug interaction alerts:</strong> FDA interaction data is
            provided for reference. Always verify with pharmacy and current
            medication reconciliation.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-blue-500 mt-1">•</span>
          <span>
            <strong>Cost estimates:</strong> Medication costs are estimates
            only. Actual patient costs may vary based on insurance, formulary,
            and pharmacy.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-blue-500 mt-1">•</span>
          <span>
            <strong>Guideline recommendations:</strong> Clinical guidelines
            should be interpreted in the context of individual patient
            circumstances.
          </span>
        </li>
      </ul>
    </div>
  );
}

export function ResponsibleAIBadge() {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-xs text-emerald-700">
      <ShieldCheck className="w-3.5 h-3.5" />
      <span>Responsible AI</span>
    </div>
  );
}
