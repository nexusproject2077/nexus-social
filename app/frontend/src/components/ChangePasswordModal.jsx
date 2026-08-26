// src/components/ChangePasswordModal.jsx
import React, { useState } from 'react';
import { X, Eye, EyeOff, Lock, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { API } from '../App';
import { useTranslation } from "react-i18next";

export default function ChangePasswordModal({ onClose }) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Validation du mot de passe
  const passwordRequirements = [
    { label: t('pwd_min_8'), valid: newPassword.length >= 8 },
    { label: t('pwd_uppercase'), valid: /[A-Z]/.test(newPassword) },
    { label: t('pwd_lowercase'), valid: /[a-z]/.test(newPassword) },
    { label: t('pwd_digit'), valid: /[0-9]/.test(newPassword) },
  ];

  const isPasswordValid = passwordRequirements.every(req => req.valid);
  const passwordsMatch = newPassword === confirmPassword && confirmPassword !== '';

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isPasswordValid) {
      toast.error(t("pwd_criteria_fail"));
      return;
    }

    if (!passwordsMatch) {
      toast.error(t("passwords_mismatch"));
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API}/users/me/password`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });

      if (response.ok) {
        toast.success(t("password_changed"));
        onClose();
      } else {
        const error = await response.json();
        toast.error(error.detail || t("error_changing"));
      }
    } catch (err) {
      toast.error(t("network_error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 rounded-2xl max-w-md w-full p-6 relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">{t("change_password")}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mot de passe actuel */}
          <div>
            <label className="text-sm text-slate-400 mb-2 block">
              Mot de passe actuel
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-11 pr-11 py-3 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
              >
                {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Nouveau mot de passe */}
          <div>
            <label className="text-sm text-slate-400 mb-2 block">
              Nouveau mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-11 pr-11 py-3 text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
              >
                {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {/* Critères du mot de passe */}
            {newPassword && (
              <div className="mt-3 space-y-1">
                {passwordRequirements.map((req, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    {req.valid ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-slate-500" />
                    )}
                    <span className={req.valid ? 'text-green-400' : 'text-slate-500'}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Confirmer le mot de passe */}
          <div>
            <label className="text-sm text-slate-400 mb-2 block">
              Confirmer le mot de passe
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full bg-slate-800 border rounded-lg pl-11 pr-4 py-3 text-white focus:ring-1 ${
                  confirmPassword && passwordsMatch
                    ? 'border-green-500 focus:border-green-500 focus:ring-green-500'
                    : confirmPassword && !passwordsMatch
                    ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                    : 'border-slate-700 focus:border-cyan-500 focus:ring-cyan-500'
                }`}
                required
              />
            </div>
            {confirmPassword && !passwordsMatch && (
              <p className="text-xs text-red-400 mt-1">{
                t("passwords_mismatch")
              }</p>
            )}
          </div>

          {/* Boutons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition-colors font-medium"
            >{
              t("cancel")
            }</button>
            <button
              type="submit"
              disabled={loading || !isPasswordValid || !passwordsMatch || !currentPassword}
              className="flex-1 px-4 py-3 rounded-lg bg-cyan-500 text-white hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {loading ? 'Changement...' : 'Changer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
