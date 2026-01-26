"use client";

import { motion } from "framer-motion";
import { User, Calendar, Pill, AlertTriangle, FileText } from "lucide-react";
import type { Patient } from "@/lib/types/patient";

interface PatientHeaderProps {
  patient: Patient | null;
  isLoading?: boolean;
}

export function PatientHeader({ patient, isLoading = false }: PatientHeaderProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 animate-pulse">
        <div className="flex items-start gap-6">
          <div className="w-16 h-16 bg-gray-200 rounded-full" />
          <div className="flex-1 space-y-3">
            <div className="h-6 bg-gray-200 rounded w-48" />
            <div className="h-4 bg-gray-200 rounded w-32" />
            <div className="flex gap-4">
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-4 bg-gray-200 rounded w-24" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6 text-center text-gray-500">
        <User className="w-12 h-12 mx-auto mb-2 text-gray-300" />
        <p>Select a patient to view details</p>
      </div>
    );
  }

  const genderLabel = patient.gender === "M" ? "Male" : patient.gender === "F" ? "Female" : "Other";

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-xl shadow-sm p-6"
    >
      <div className="flex items-start gap-6">
        {/* Avatar */}
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
          {patient.name.split(" ").map((n) => n[0]).join("")}
        </div>

        {/* Patient Info */}
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{patient.name}</h2>
              <p className="text-gray-500">
                {patient.age} years old · {genderLabel}
                {patient.mrn && <span className="ml-2">· MRN: {patient.mrn}</span>}
              </p>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex flex-wrap gap-6 mt-4">
            <div className="flex items-center gap-2 text-gray-600">
              <Calendar className="w-4 h-4" />
              <span className="text-sm">
                Admitted: {new Date(patient.admissionDate).toLocaleDateString()}
              </span>
            </div>

            <div className="flex items-center gap-2 text-gray-600">
              <Pill className="w-4 h-4" />
              <span className="text-sm">{patient.medications.length} Medications</span>
            </div>

            <div className="flex items-center gap-2 text-gray-600">
              <FileText className="w-4 h-4" />
              <span className="text-sm">{patient.diagnoses.length} Diagnoses</span>
            </div>

            {patient.allergies.length > 0 && (
              <div className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm">{patient.allergies.length} Allergies</span>
              </div>
            )}
          </div>

          {/* Diagnoses */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-500 mb-2">Active Diagnoses</h4>
            <div className="flex flex-wrap gap-2">
              {patient.diagnoses
                .filter((d) => d.status === "active")
                .slice(0, 4)
                .map((diagnosis, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-700"
                  >
                    {diagnosis.display}
                  </span>
                ))}
              {patient.diagnoses.filter((d) => d.status === "active").length > 4 && (
                <span className="px-3 py-1 bg-gray-100 rounded-full text-sm text-gray-500">
                  +{patient.diagnoses.filter((d) => d.status === "active").length - 4} more
                </span>
              )}
            </div>
          </div>

          {/* Allergies */}
          {patient.allergies.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-red-500 mb-2">Allergies</h4>
              <div className="flex flex-wrap gap-2">
                {patient.allergies.map((allergy, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 bg-red-50 border border-red-200 rounded-full text-sm text-red-700"
                  >
                    {allergy}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Vital Signs (if available) */}
      {patient.vitalSigns && (
        <div className="mt-6 pt-4 border-t border-gray-100">
          <h4 className="text-sm font-medium text-gray-500 mb-3">Latest Vitals</h4>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {patient.vitalSigns.bloodPressure && (
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">
                  {patient.vitalSigns.bloodPressure}
                </p>
                <p className="text-xs text-gray-500">BP (mmHg)</p>
              </div>
            )}
            {patient.vitalSigns.heartRate && (
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">
                  {patient.vitalSigns.heartRate}
                </p>
                <p className="text-xs text-gray-500">HR (bpm)</p>
              </div>
            )}
            {patient.vitalSigns.temperature && (
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">
                  {patient.vitalSigns.temperature}°F
                </p>
                <p className="text-xs text-gray-500">Temp</p>
              </div>
            )}
            {patient.vitalSigns.respiratoryRate && (
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">
                  {patient.vitalSigns.respiratoryRate}
                </p>
                <p className="text-xs text-gray-500">RR (/min)</p>
              </div>
            )}
            {patient.vitalSigns.oxygenSaturation && (
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">
                  {patient.vitalSigns.oxygenSaturation}%
                </p>
                <p className="text-xs text-gray-500">SpO2</p>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}
