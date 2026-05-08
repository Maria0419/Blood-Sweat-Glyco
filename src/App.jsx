import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { calculateGlucoseImpact } from './utils/metrics';
import WorkoutChart from './components/WorkoutChart';
import SeriesToggle from './components/SeriesToggle';
import GlucoseImpactCard from './components/GlucoseImpactCard';
import WorkoutSummaryCard from './components/WorkoutSummaryCard';
import InsulinCard from './components/InsulinCard';
import CommentsPanel from './components/CommentsPanel';
import Calendar from './components/Calendar';
import {
  formatDayMonthSP,
  formatMonthYearSP,
  formatTimeSP,
  getDateKeyFromDate,
  getSaoPauloDateKey,
} from './utils/time';
import { translateSport } from './utils/sports';
import { Activity, Droplets, Clock, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Menu, ChevronDown, Settings, Watch, Link as LinkIcon, RefreshCw, LogOut, CheckCircle2, AlertCircle, Eye, EyeOff, X, Upload, CheckSquare, Square, Pencil, Trash2 } from 'lucide-react';

function NotificationModal({ notification, onClose }) {
  if (!notification) return null;
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-clinical-card rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 p-6 flex flex-col items-center text-center" onClick={e => e.stopPropagation()}>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${notification.type === 'error' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
          {notification.type === 'error' ? <AlertCircle size={24} /> : <CheckCircle2 size={24} />}
        </div>
        <h3 className="text-lg font-bold text-clinical-text mb-2">{notification.title}</h3>
        <p className="text-sm text-clinical-secondary mb-6">{notification.message}</p>
        <button onClick={onClose} className="w-full py-2.5 bg-clinical-primary text-white font-bold rounded-xl hover:bg-opacity-90 transition-all">
          Entendido
        </button>
      </div>
    </div>
  );
}

function SettingsModal({ isOpen, onClose, onWorkoutsUpdated, isDarkMode, setIsDarkMode, targetLimits, setTargetLimits, targetGoal, setTargetGoal, showNotification, tags, onAddTag, onDeleteTag }) {
  const [activeTab, setActiveTab] = useState('appearance');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [garminStatus, setGarminStatus] = useState('disconnected');
  const [profileName, setProfileName] = useState('');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);

  const [clSyncing, setClSyncing] = useState(false);
  const [clError, setClError] = useState(null);

  const colors = ['#EF4444', '#F97316', '#F59E0B', '#10B981', '#3B82F6', '#6366F1', '#8B5CF6', '#D946EF'];
  const [editingTagId, setEditingTagId] = useState(null);
  const [editingTagLabel, setEditingTagLabel] = useState('');
  const [editingTagColor, setEditingTagColor] = useState('');
  const [tagError, setTagError] = useState(null);

  const startEditTag = (tag) => {
    setEditingTagId(tag.id);
    setEditingTagLabel(tag.label);
    setEditingTagColor(tag.color || '#F59E0B');
    setTagError(null);
  };

  const cancelEditTag = () => {
    setEditingTagId(null);
    setEditingTagLabel('');
    setEditingTagColor('');
    setTagError(null);
  };

  const saveEditTag = async () => {
    if (!editingTagLabel.trim()) {
      setTagError('O nome da tag não pode ser vazio.');
      return;
    }
    
    const newLabel = editingTagLabel.trim().toLowerCase();
    const isDuplicate = tags.some(t => 
      t.id !== editingTagId && 
      t.label.toLowerCase() === newLabel
    );
    
    if (isDuplicate) {
      setTagError(`Já existe uma tag com o nome "${editingTagLabel.trim()}"`);
      return;
    }
    
    try {
      setTagError(null);
      await onAddTag(editingTagLabel.trim(), editingTagColor, editingTagId);
      setEditingTagId(null);
    } catch (e) {
      console.error(e);
      setTagError('Erro ao salvar tag.');
    }
  };

  const handleEditTagKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEditTag();
    }

    if (e.key === 'Escape') {
      cancelEditTag();
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkAuth();
      setError(null);
      setClError(null);
    }
  }, [isOpen]);

  const checkAuth = async () => {
    try {
      const res = await window.electronAPI.checkGarminAuth();
      if (res.status === 'connected') {
        setGarminStatus('connected');
        setProfileName(res.profileName);
      } else {
        setGarminStatus('disconnected');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnectGarmin = async (e) => {
    if (e) e.preventDefault();
    if (!email || !password) {
      setError('Por favor, preencha o e-mail e a senha.');
      return;
    }
    
    setConnecting(true);
    setError(null);
    try {
      const result = await window.electronAPI.connectGarmin(email, password);
      if (result.status === 'success') {
        setGarminStatus('connected');
        setProfileName(result.profileName);
        setEmail('');
        setPassword('');
      } else {
        let msg = result.message;
        if (msg.includes('credentials')) msg = 'E-mail ou senha incorretos.';
        if (msg.includes('rate limit')) msg = 'Muitas tentativas. Tente novamente mais tarde.';
        setError(msg || 'Falha na autenticação.');
      }
    } catch (e) {
      setError('Erro ao comunicar com o processo principal.');
    } finally {
      setConnecting(false);
    }
  };

  const handleLogoutGarmin = async () => {
    try {
      await window.electronAPI.logoutGarmin();
      setGarminStatus('disconnected');
      setProfileName('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleSyncGarmin = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await window.electronAPI.syncGarmin();
      if (res.status === 'success') {
        if (res.downloaded > 0) {
          onWorkoutsUpdated();
        }
        showNotification('Sincronização Concluída', `${res.downloaded} novos treinos baixados.`);
      } else {
        setError(res.message || 'Falha na sincronização.');
      }
    } catch (e) {
      setError('Erro inesperado ao sincronizar.');
    } finally {
      setSyncing(false);
    }
  };

  const handleUploadCSV = async () => {
    setClSyncing(true);
    setClError(null);
    try {
      const res = await window.electronAPI.uploadCareLinkCSV();
      if (res.status === 'success') {
        showNotification('CareLink Importado', `${res.readings} registros de glicose processados. ${res.workoutsUpdated} treinos enriquecidos.`);
        onWorkoutsUpdated(true);
      } else if (res.status === 'error') {
        setClError(res.message);
      }
    } catch (e) {
      setClError('Erro ao carregar CSV.');
    } finally {
      setClSyncing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-clinical-card rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 relative max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 pb-2 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold text-clinical-text flex items-center gap-2">
            <Settings size={20} className="text-clinical-primary" />
            Configurações
          </h2>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-clinical-bg rounded-full text-clinical-secondary transition-colors"
            title="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex px-6 pt-2 border-b border-clinical-border shrink-0">
          <button
            onClick={() => setActiveTab('appearance')}
            className={`pb-3 px-4 text-sm font-bold transition-all border-b-2 ${activeTab === 'appearance' ? 'border-clinical-primary text-clinical-primary' : 'border-transparent text-clinical-secondary hover:text-clinical-text'}`}
          >
            Aparência
          </button>
          <button
            onClick={() => setActiveTab('integrations')}
            className={`pb-3 px-4 text-sm font-bold transition-all border-b-2 ${activeTab === 'integrations' ? 'border-clinical-primary text-clinical-primary' : 'border-transparent text-clinical-secondary hover:text-clinical-text'}`}
          >
            Integrações
          </button>
          <button
            onClick={() => setActiveTab('tags')}
            className={`pb-3 px-4 text-sm font-bold transition-all border-b-2 ${activeTab === 'tags' ? 'border-clinical-primary text-clinical-primary' : 'border-transparent text-clinical-secondary hover:text-clinical-text'}`}
          >
            Tags
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto scrollbar-stable">
          {activeTab === 'tags' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h3 className="text-xs font-black uppercase tracking-widest text-clinical-secondary">Gerenciamento de Tags</h3>
              <p className="text-xs text-clinical-secondary">Aqui você pode editar o nome, a cor ou deletar as tags criadas nos comentários.</p>
              
              <div className="flex flex-col gap-2">
                {(!Array.isArray(tags) || tags.filter(t => t && t.id).length === 0) ? (
                  <p className="text-sm text-clinical-secondary text-center py-4 bg-clinical-bg rounded-xl border border-clinical-border">Nenhuma tag cadastrada.</p>
                ) : (
                  tags.filter(t => t && t.id).map(tag => (
                    <div key={tag.id} className="p-3 bg-clinical-bg border border-clinical-border rounded-xl flex items-center justify-between group transition-all">
                      {editingTagId === tag.id ? (
                        <div className="flex flex-col gap-2 w-full">
                          <input
                            type="text"
                            value={editingTagLabel || ''}
                            onChange={(e) => {
                              setEditingTagLabel(e.target.value);
                              setTagError(null);
                            }}
                            onKeyDown={handleEditTagKeyDown}
                            onBlur={saveEditTag}
                            className={`w-full px-2 py-1.5 bg-clinical-card border rounded-lg text-sm font-bold focus:outline-none focus:ring-2 ${
                              tagError ? 'border-red-500 focus:ring-red-500' : 'border-clinical-border focus:ring-amber-500'
                            }`}
                            autoFocus
                          />
                          {tagError && (
                            <p className="text-xs text-red-500 font-semibold">{tagError}</p>
                          )}
                          <div className="flex gap-1.5 flex-wrap">
                            {colors.map(color => (
                              <button
                                key={color}
                                onClick={() => setEditingTagColor(color)}
                                className={`w-5 h-5 rounded-full border-2 transition-all ${editingTagColor === color ? 'border-white shadow-sm ring-1 ring-clinical-border' : 'border-transparent hover:scale-110'}`}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                          <div className="flex gap-2 justify-end mt-1">
                            <button onClick={cancelEditTag} className="text-xs font-bold text-clinical-secondary hover:text-clinical-text px-2 py-1">Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <span 
                            className="text-xs font-bold px-2 py-1 rounded text-white" 
                            style={{ backgroundColor: tag.color || '#F59E0B' }}
                          >
                            {tag.label || 'Tag Sem Nome'}
                          </span>
                          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => startEditTag(tag)}
                              className="p-1.5 text-clinical-secondary hover:text-amber-500 hover:bg-clinical-card rounded-md transition-colors"
                              title="Editar"
                            >
                              <Pencil size={14} />
                            </button>
                            <button 
                              onClick={async () => {
                                if (window.confirm(`Tem certeza que deseja excluir a tag "${tag.label || 'Tag Sem Nome'}"?`)) {
                                  await onDeleteTag(tag.id);
                                }
                              }}
                              className="p-1.5 text-clinical-secondary hover:text-red-500 hover:bg-clinical-card rounded-md transition-colors"
                              title="Excluir"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h3 className="text-xs font-black uppercase tracking-widest text-clinical-secondary">Aparência e Gráficos</h3>
              
              <div className="p-4 bg-clinical-bg border border-clinical-border rounded-xl flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-bold text-sm text-clinical-text">Modo Escuro</span>
                    <span className="text-xs text-clinical-secondary">Alternar tema da aplicação</span>
                  </div>
                  <button
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${isDarkMode ? 'bg-clinical-primary' : 'bg-clinical-secondary/30'}`}
                  >
                    <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${isDarkMode ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div className="h-px bg-clinical-border w-full my-1"></div>

                <div className="flex flex-col gap-2">
                  <span className="font-bold text-sm text-clinical-text">Metas de Glicemia (mg/dL)</span>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-[10px] text-clinical-secondary font-bold uppercase tracking-wider">Mínimo</label>
                      <input 
                        type="number" 
                        value={targetLimits?.min ?? 70}
                        onChange={(e) => setTargetLimits(prev => ({...prev, min: Number(e.target.value)}))}
                        className="w-full px-3 py-2 bg-clinical-card border border-clinical-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinical-primary text-clinical-text font-mono font-bold"
                      />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-[10px] text-clinical-secondary font-bold uppercase tracking-wider">Ideal (Meta)</label>
                      <input 
                        type="number" 
                        value={targetGoal ?? 100}
                        onChange={(e) => setTargetGoal(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-clinical-card border border-clinical-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinical-primary text-clinical-text font-mono font-bold"
                      />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-[10px] text-clinical-secondary font-bold uppercase tracking-wider">Máximo</label>
                      <input 
                        type="number" 
                        value={targetLimits?.max ?? 180}
                        onChange={(e) => setTargetLimits(prev => ({...prev, max: Number(e.target.value)}))}
                        className="w-full px-3 py-2 bg-clinical-card border border-clinical-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-clinical-primary text-clinical-text font-mono font-bold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-clinical-secondary">Garmin Connect</h3>
                
                <div className="p-4 bg-clinical-bg border border-clinical-border rounded-xl flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center text-white shadow-sm shrink-0">
                      <Watch size={24} />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-clinical-text">Sincronização de Treinos</h4>
                      {garminStatus === 'connected' ? (
                        <p className="text-xs text-green-600 font-bold flex items-center gap-1 mt-0.5">
                          <CheckCircle2 size={12} /> Conectado como {profileName}
                        </p>
                      ) : (
                        <p className="text-xs text-clinical-secondary">Insira suas credenciais do Garmin</p>
                      )}
                    </div>
                  </div>

                  {error && (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-2.5 rounded-lg text-xs flex items-start gap-2 border border-red-100 dark:border-red-900/30">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <p>{error}</p>
                    </div>
                  )}

                  {garminStatus === 'disconnected' ? (
                    <form onSubmit={handleConnectGarmin} className="flex flex-col gap-2 mt-2">
                      <input 
                        type="email" 
                        placeholder="E-mail Garmin" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 bg-clinical-card border border-clinical-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 text-clinical-text"
                      />
                      <div className="relative">
                        <input 
                          type={showPassword ? "text" : "password"} 
                          placeholder="Senha" 
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full px-3 py-2 bg-clinical-card border border-clinical-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 text-clinical-text pr-10"
                        />
                        <button
                          type="button"
                          tabIndex="-1"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-clinical-secondary hover:text-clinical-text"
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <button 
                        type="submit"
                        disabled={connecting}
                        className="mt-1 w-full py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {connecting ? <Clock size={16} className="animate-spin" /> : <LinkIcon size={16} />}
                        {connecting ? 'Conectando...' : 'Fazer Login'}
                      </button>
                    </form>
                  ) : (
                    <div className="flex flex-col gap-2 mt-2">
                      <button 
                        onClick={handleSyncGarmin}
                        disabled={syncing}
                        className="w-full py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
                        {syncing ? 'Buscando novos treinos...' : 'Sincronizar Últimos Treinos'}
                      </button>
                      <button 
                        onClick={handleLogoutGarmin}
                        disabled={syncing}
                        className="w-full py-2 text-red-600 text-xs font-bold rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                      >
                        <LogOut size={14} />
                        Desconectar Conta
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-clinical-secondary pt-2">Medtronic CareLink</h3>
                <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/20 rounded-xl flex flex-col gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm shrink-0">
                      <Droplets size={24} />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-clinical-text">Importação por CSV</h4>
                      <p className="text-xs text-clinical-secondary mt-0.5">
                        Carregue o arquivo CSV exportado do CareLink para enriquecer os treinos com glicose e insulina.
                      </p>
                    </div>
                  </div>

                  {clError && (
                    <div className="bg-red-50 dark:bg-red-900/20 text-red-600 p-2.5 rounded-lg text-xs flex items-start gap-2 border border-red-100 dark:border-red-900/30">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <p>{clError}</p>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 mt-2">
                    <button 
                      onClick={handleUploadCSV}
                      disabled={clSyncing}
                      className="w-full py-2.5 bg-clinical-card text-blue-600 border border-blue-600 text-sm font-bold rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/10 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                    >
                      {clSyncing ? <Clock size={16} className="animate-spin" /> : <Upload size={16} />}
                      {clSyncing ? 'Processando CSV...' : 'Carregar CSV do CareLink'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [workouts, setWorkouts] = useState([]);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingWorkout, setLoadingWorkout] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [filterDate, setFilterDate] = useState(null);
  const [sportFilters, setSportFilters] = useState([]);
  const [isSportDropdownOpen, setIsSportDropdownOpen] = useState(false);
  const sportDropdownRef = useRef(null);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [globalSyncState, setGlobalSyncState] = useState({ isSyncing: false, message: '' });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : true;
  });
  const [targetLimits, setTargetLimits] = useState(() => {
    const saved = localStorage.getItem('targetLimits');
    return saved ? JSON.parse(saved) : { min: 70, max: 180 };
  });
  const [targetGoal, setTargetGoal] = useState(() => {
    const saved = localStorage.getItem('targetGoal');
    return saved ? JSON.parse(saved) : 100;
  });
  const [comments, setComments] = useState([]);
  const [commentMode, setCommentMode] = useState(false);
  const [tags, setTags] = useState([]);
  const [customInsulin, setCustomInsulin] = useState(() => {
    const saved = localStorage.getItem('customInsulin');
    return saved ? JSON.parse(saved) : {};
  });
  const [notification, setNotification] = useState(null);

  const showNotification = (title, message, type = 'success') => {
    setNotification({ title, message, type });
  };

  useEffect(() => {
    window.electronAPI.loadTags().then(setTags).catch(console.error);
  }, []);

  useEffect(() => {
    localStorage.setItem('targetLimits', JSON.stringify(targetLimits));
  }, [targetLimits]);

  useEffect(() => {
    localStorage.setItem('targetGoal', JSON.stringify(targetGoal));
  }, [targetGoal]);

  useEffect(() => {
    localStorage.setItem('customInsulin', JSON.stringify(customInsulin));
  }, [customInsulin]);

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleGroup = (label) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [label]: !prev[label]
    }));
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (sportDropdownRef.current && !sportDropdownRef.current.contains(e.target)) {
        setIsSportDropdownOpen(false);
      }
    }
    if (isSportDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isSportDropdownOpen]);

  const [activeSeries, setActiveSeries] = useState({
    glucose: true,
    bolus: true,
    heartRate: false,
    pace: true,
    relativeLoad: false
  });
useEffect(() => {
  let isMounted = true;
  async function init() {
    try {
      const list = await window.electronAPI.listWorkouts();      if (!isMounted) return;
      
      const sortedList = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
      setWorkouts(sortedList);
      if (sortedList.length > 0) {
        setSelectedWorkoutId(sortedList[0].id);
      }

      // Libera a tela principal imediatamente
      if (isMounted) setLoading(false);

      // Sincronização Automática na Inicialização em background
      const auth = await window.electronAPI.checkGarminAuth();
      if (isMounted && auth.status === 'connected') {
        setGlobalSyncState({ isSyncing: true, message: 'Buscando treinos novos...' });
        console.log('Sincronizando Garmin automaticamente...');
        const syncRes = await window.electronAPI.syncGarmin();
        if (syncRes.status === 'success' && syncRes.downloaded > 0) {
          const updatedList = await window.electronAPI.listWorkouts();
          const sortedUpdated = [...updatedList].sort((a, b) => new Date(b.date) - new Date(a.date));
          if (isMounted) setWorkouts(sortedUpdated);
        }
      }

    } catch (err) {
      console.error("Erro na inicialização/sincronização", err);
    } finally {
      if (isMounted) {
        setLoading(false);
        setGlobalSyncState({ isSyncing: false, message: '' });
      }
    }
  }
  init();
  return () => { isMounted = false; };
}, []);

  useEffect(() => {
    if (!selectedWorkoutId) return;

    const workoutInfo = workouts.find(w => w.id === selectedWorkoutId);
    if (workoutInfo) {
      const sportKey = (workoutInfo.sport || '').toLowerCase();
      const hasPace = ['running', 'treadmill_running', 'indoor_running', 'trail_running', 'track_running', 'ultra_run', 'street_running', 'walking', 'indoor_walking', 'speed_walking', 'hiking', 'cycling', 'road_biking', 'road_cycling', 'mountain_biking', 'gravel_cycling', 'indoor_cycling'].includes(sportKey);
      setActiveSeries(prev => ({
        ...prev,
        pace: hasPace,
        relativeLoad: !hasPace
      }));
    }

    async function loadWorkoutData() {
      setLoadingWorkout(true);
      setCommentMode(false);
      try {
        const [{ workoutData, carelinkData }, loadedComments] = await Promise.all([
          window.electronAPI.loadWorkout(selectedWorkoutId),
          window.electronAPI.loadComments(selectedWorkoutId)
        ]);
        
        const glucoseImpact = calculateGlucoseImpact(
          carelinkData.sgvReadings, 
          workoutData.workoutStart, 
          workoutData.workoutEnd
        );
        
        setData({
          trackpoints: workoutData.trackpoints,
          carelink: carelinkData,
          metrics: workoutData.metrics,
          glucoseImpact,
          workoutStart: workoutData.workoutStart,
          workoutEnd: workoutData.workoutEnd
        });
        setComments(loadedComments || []);
      } catch (err) {
        console.error("Erro ao carregar treino", err);
      } finally {
        setLoadingWorkout(false);
      }
    }
    loadWorkoutData();
  }, [selectedWorkoutId, reloadCounter]);

  const availableSports = useMemo(() => {
    const sports = new Set();
    workouts.forEach(w => {
      sports.add(translateSport(w.sport));
    });
    return Array.from(sports).sort();
  }, [workouts]);

  const groupedWorkouts = useMemo(() => {
    const selectedDateKey = filterDate ? getDateKeyFromDate(filterDate) : null;
    
    let filtered = workouts;
    
    // Filtro de Data
    if (selectedDateKey) {
      filtered = filtered.filter(w => getSaoPauloDateKey(w.date) === selectedDateKey);
    }
    
    // Filtro de Esporte
    if (sportFilters.length > 0) {
      filtered = filtered.filter(w => sportFilters.includes(translateSport(w.sport)));
    }

    const groups = [];
    filtered.forEach(w => {
      const monthLabel = formatMonthYearSP(w.date);
      
      let group = groups.find(g => g.label === monthLabel);
      if (!group) {
        group = { label: monthLabel, items: [] };
        groups.push(group);
      }
      group.items.push(w);
    });
    return groups;
  }, [workouts, filterDate, sportFilters]);

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-clinical-bg"><Clock className="animate-spin text-clinical-primary" /></div>
  );

  return (
    <div className="flex h-screen bg-clinical-bg text-clinical-text font-sans overflow-hidden">
      {/* Sidebar Retrátil Ultra Otimizada */}
      <aside 
        className={`bg-clinical-card flex flex-col transition-[width,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] relative overflow-hidden shrink-0 will-change-[width,opacity] transform-gpu ${
          isSidebarOpen ? 'w-80 border-r border-clinical-border opacity-100' : 'w-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="w-80 flex flex-col h-full shrink-0">
          <div className="p-6 border-b border-clinical-border flex items-center justify-center relative">
            <div className="absolute left-6">
              <div className="w-12 h-12 rounded flex items-center justify-center overflow-hidden bg-transparent">
                <img src="./bsg.png" alt="BS&G Logo" className="w-full h-full object-contain" />
              </div>
            </div>
            <span className="font-bold text-base tracking-tight text-clinical-text">Blood Sweat & Glyco</span>
            <button 
              onClick={() => setIsSidebarOpen(false)}
              className="absolute right-6 p-1.5 hover:bg-clinical-bg rounded-lg text-clinical-secondary transition-colors"
            >
              <ChevronLeft size={20} />
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 scrollbar-stable">
            <div className="mb-4">
              <button 
                onClick={() => setIsCalendarExpanded(!isCalendarExpanded)}
                className="w-full flex items-center justify-between px-3 py-2 bg-clinical-bg hover:bg-clinical-card rounded-xl border border-clinical-border transition-all group"
              >
                <div className="flex items-center gap-2">
                  <CalendarIcon size={16} className="text-clinical-primary" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-clinical-text/70">Calendário de Treinos</span>
                </div>
                <ChevronDown 
                  size={16} 
                  className={`text-clinical-secondary transition-transform duration-300 ${isCalendarExpanded ? 'rotate-180' : ''}`} 
                />
              </button>
              
              <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isCalendarExpanded ? 'max-h-80 mt-2 opacity-100' : 'max-h-0 opacity-0'}`}>
                <Calendar 
                  workouts={workouts} 
                  selectedDate={filterDate} 
                  onSelectDate={setFilterDate} 
                />
              </div>
            </div>

            <div className="mb-6">
              <div className="flex items-center justify-between mb-3 px-2">
                <h2 className="text-[10px] font-bold text-clinical-secondary uppercase tracking-widest">Atividades</h2>
                {(filterDate || sportFilters.length > 0) && (
                  <button 
                    onClick={() => { setFilterDate(null); setSportFilters([]); }}
                    className="text-[10px] text-clinical-primary font-bold hover:underline"
                  >
                    Limpar Filtros
                  </button>
                )}
              </div>
              
              <div className="relative px-2" ref={sportDropdownRef}>
                <button 
                  onClick={() => setIsSportDropdownOpen(!isSportDropdownOpen)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-clinical-card border border-clinical-border rounded-xl text-xs font-bold text-clinical-text transition-all hover:border-clinical-primary"
                >
                  <span className="truncate">
                    {sportFilters.length === 0 ? 'Todos os Esportes' : `${sportFilters.length} selecionado(s)`}
                  </span>
                  <ChevronDown size={14} className={`text-clinical-secondary transition-transform ${isSportDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {isSportDropdownOpen && (
                  <div className="absolute top-full left-2 right-2 mt-1 bg-clinical-card border border-clinical-border rounded-xl shadow-lg z-50 overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200 max-h-60">
                    <div className="p-2 border-b border-clinical-border">
                      <button 
                        onClick={() => setSportFilters([])}
                        className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${sportFilters.length === 0 ? 'bg-clinical-primary/10 text-clinical-primary' : 'text-clinical-secondary hover:bg-clinical-bg'}`}
                      >
                        {sportFilters.length === 0 ? <CheckSquare size={14} className="text-clinical-primary" /> : <Square size={14} />}
                        Todos os Esportes
                      </button>
                    </div>
                    <div className="overflow-y-auto p-2 flex flex-col gap-1 scrollbar-stable">
                      {availableSports.map(sport => {
                        const isSelected = sportFilters.includes(sport);
                        return (
                          <button
                            key={sport}
                            onClick={() => {
                              setSportFilters(prev => 
                                prev.includes(sport) ? prev.filter(s => s !== sport) : [...prev, sport]
                              );
                            }}
                            className={`w-full text-left px-2 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${isSelected ? 'bg-clinical-primary/10 text-clinical-primary' : 'text-clinical-text hover:bg-clinical-bg'}`}
                          >
                            {isSelected ? <CheckSquare size={14} className="text-clinical-primary" /> : <Square size={14} className="text-clinical-secondary" />}
                            {sport}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              {groupedWorkouts.length > 0 ? (
                groupedWorkouts.map((group) => (
                  <div key={group.label} className="space-y-1">
                    <button 
                      onClick={() => toggleGroup(group.label)}
                      className="w-full flex items-center gap-2 group-btn cursor-pointer px-3 mb-2"
                    >
                      <div className="h-px bg-clinical-primary/10 dark:bg-clinical-primary/5 flex-1" />
                      <h3 className="text-[10px] font-black text-clinical-primary uppercase tracking-widest shrink-0">
                        {group.label}
                      </h3>
                      <ChevronDown 
                        size={14} 
                        className={`text-clinical-primary/50 transition-transform duration-300 shrink-0 ${collapsedGroups[group.label] ? 'rotate-180' : ''}`} 
                      />
                    </button>
                    <div className={`space-y-1 overflow-hidden transition-all duration-300 ease-in-out ${collapsedGroups[group.label] ? 'max-h-0 opacity-0' : 'max-h-[2000px] opacity-100'}`}>
                      {group.items.map((w) => (
                        <button
                          key={w.id}
                          onClick={() => setSelectedWorkoutId(w.id)}
                          className={`w-full flex flex-col gap-0.5 px-3 py-3 rounded-xl text-left transition-all ${
                            selectedWorkoutId === w.id 
                              ? 'bg-clinical-primary text-white shadow-md' 
                              : 'text-clinical-secondary hover:bg-clinical-bg'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <p className={`text-[10px] font-black uppercase tracking-widest ${selectedWorkoutId === w.id ? 'text-white/80' : 'text-clinical-primary'}`}>
                              {translateSport(w.sport)}
                            </p>
                            <Clock size={12} className={selectedWorkoutId === w.id ? 'text-white/60' : 'text-clinical-secondary'} />
                          </div>
                          <p className="text-sm font-bold leading-tight text-clinical-text">
                            {formatDayMonthSP(w.date)}
                          </p>
                          <p className={`text-[10px] font-medium ${selectedWorkoutId === w.id ? 'text-white/60' : 'text-clinical-secondary/70'}`}>
                            {formatTimeSP(w.date)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-center bg-clinical-bg rounded-2xl border border-dashed border-clinical-border mx-2">
                  <Watch size={32} className="mx-auto text-clinical-secondary/30 mb-3" />
                  <p className="text-xs font-bold text-clinical-secondary mb-1">
                    {workouts.length === 0 ? 'Nenhum treino encontrado' : 'Nenhum treino com este filtro'}
                  </p>
                  <p className="text-[10px] text-clinical-secondary/50 leading-relaxed">
                    {workouts.length === 0 
                      ? 'Certifique-se de fazer login no Garmin nas Configurações para sincronizar seus dados.'
                      : 'Tente mudar o filtro de esporte ou a data no calendário.'
                    }
                  </p>
                </div>
              )}
            </div>
          </div>
          
          {/* Sidebar Footer / Settings */}
          <div className="p-4 border-t border-clinical-border flex flex-col gap-2">
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="w-full flex items-center justify-between px-3 py-2 bg-clinical-card hover:bg-clinical-bg rounded-xl border border-transparent hover:border-clinical-border transition-all group"
            >
              <div className="flex items-center gap-2">
                <Settings size={16} className="text-clinical-secondary group-hover:text-clinical-primary transition-colors" />
                <span className="text-[10px] font-black uppercase tracking-widest text-clinical-secondary">Configurações</span>
              </div>
            </button>
          </div>
        </div>
      </aside>


      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        onWorkoutsUpdated={async (shouldReloadCurrent = false) => {
          const list = await window.electronAPI.listWorkouts();
          const sortedList = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
          setWorkouts(sortedList);
          if (shouldReloadCurrent) {
            setReloadCounter(prev => prev + 1);
          }
        }}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        targetLimits={targetLimits}
        setTargetLimits={setTargetLimits}
        targetGoal={targetGoal}
        setTargetGoal={setTargetGoal}
        showNotification={showNotification}
        tags={tags}
        onAddTag={async (label, color, forceId = null) => {
          const existingTag = forceId ? tags.find(t => t.id === forceId) : tags.find(t => t.label?.toLowerCase() === label?.toLowerCase());
          const tagData = { 
            id: existingTag ? existingTag.id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, 
            label: existingTag && !forceId ? existingTag.label : label,
            color 
          };
          const updated = await window.electronAPI.saveTag(tagData);
          setTags(updated);
          return tagData;
        }}
        onDeleteTag={async (tagId) => {
          const updated = await window.electronAPI.deleteTag(tagId);
          setTags(updated);
        }}
      />

      <NotificationModal notification={notification} onClose={() => setNotification(null)} />

      {/* Botão de abrir sidebar quando fechada */}
      {!isSidebarOpen && (
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="absolute top-6 left-6 z-50 p-2 bg-clinical-card rounded-lg shadow-md border border-clinical-border hover:bg-clinical-bg text-blue-600 animate-in fade-in duration-300"
        >
          <Menu size={20} />
        </button>
      )}

      {/* Conteúdo Principal */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Barra de carregamento em background (Sincronização global) */}
        {globalSyncState.isSyncing && (
          <div className="absolute top-0 left-0 right-0 z-50 pointer-events-none">
            <div className="h-1 w-full bg-blue-100 dark:bg-blue-900/20 overflow-hidden relative">
              <div className="absolute top-0 left-0 h-full bg-blue-600 animate-[pulse_1s_ease-in-out_infinite] transition-all duration-300" style={{ width: '100%' }}></div>
            </div>
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-bold px-4 py-1.5 rounded-full shadow-md flex items-center gap-2 animate-in slide-in-from-top-2">
              <RefreshCw size={12} className="animate-spin" />
              {globalSyncState.message}
            </div>
          </div>
        )}

        {loadingWorkout && (
          <div className="absolute inset-0 bg-clinical-bg/50 backdrop-blur-[1px] z-50 flex items-center justify-center">
            <Clock className="animate-spin text-blue-600" />
          </div>
        )}

        {data ? (
          <>
            <header className="h-20 bg-clinical-card border-b border-clinical-border flex items-center justify-between px-8 shrink-0">
              <div className={!isSidebarOpen ? 'pl-12 transition-all' : ''}>
                <h1 className="text-lg font-bold flex items-center gap-2 text-clinical-text">
                  {translateSport(workouts.find(w => w.id === selectedWorkoutId)?.sport) || 'Atividade'} 
                  <span className="text-clinical-secondary font-normal">—</span>
                  {formatDayMonthSP(data.workoutStart)}
                </h1>
                <p className="text-[10px] text-clinical-secondary uppercase tracking-widest font-bold">Análise Detalhada • Garmin Venu 3S</p>
              </div>
              <div className="flex gap-8">
                <HeaderStat label="Duração" value={data.metrics.duration} />
                <HeaderStat label="Distância" value={`${data.metrics.distanceKm} km`} />
              </div>
            </header>

            <div className="flex-1 flex overflow-hidden p-6 gap-6 min-w-0">
              <div className="flex-1 flex flex-col gap-6 overflow-hidden min-w-0">
                <div className="bg-clinical-card rounded-xl border border-clinical-border p-6 flex flex-col flex-1 overflow-hidden shadow-sm min-w-0">
                  <div className="flex items-center justify-between mb-6">
                    <SeriesToggle activeSeries={activeSeries} onToggle={(key) => setActiveSeries(prev => ({...prev, [key]: !prev[key]}))} />
                  </div>
                  <div className="flex-1 min-h-0 min-w-0">
                    <WorkoutChart
                      key={selectedWorkoutId}
                      data={data}
                      activeSeries={activeSeries}
                      isDarkMode={isDarkMode}
                      targetLimits={targetLimits}
                      targetGoal={targetGoal}
                      comments={comments}
                      commentMode={commentMode}
                      tags={tags}
                      onAddTag={async (label, color) => {
                        const existingTag = tags.find(t => t?.label && t.label.toLowerCase() === (label || '').toLowerCase());
                        const tagData = { 
                          id: existingTag ? existingTag.id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, 
                          label: existingTag ? existingTag.label : label,
                          color 
                        };
                        const updated = await window.electronAPI.saveTag(tagData);
                        setTags(updated);
                        return tagData;
                      }}
                      onCommentModeToggle={() => setCommentMode(prev => !prev)}
                      onAddComment={async (timestamp, title, text) => {
                        const comment = {
                          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                          timestamp,
                          title,
                          text,
                          createdAt: new Date().toISOString()
                        };
                        const updated = await window.electronAPI.saveComment(selectedWorkoutId, comment);
                        setComments(updated);
                      }}
                    />
                  </div>
                </div>
              </div>

              <aside className="w-80 flex flex-col gap-6 overflow-y-auto pr-2 shrink-0">
                <GlucoseImpactCard impact={data.glucoseImpact} />
                <WorkoutSummaryCard metrics={data.metrics} />
                <InsulinCard 
                  carelink={data.carelink} 
                  workoutStart={data.workoutStart} 
                  workoutEnd={data.workoutEnd}
                  customInsulin={customInsulin[selectedWorkoutId]}
                  onInsulinChange={(value) => setCustomInsulin(prev => ({ ...prev, [selectedWorkoutId]: value }))}
                />
                <CommentsPanel
                  comments={comments}
                  tags={tags}
                  onAddTag={async (label, color) => {
                    const existingTag = tags.find(t => t?.label && t.label.toLowerCase() === (label || '').toLowerCase());
                    const tagData = { 
                      id: existingTag ? existingTag.id : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, 
                      label: existingTag ? existingTag.label : label,
                      color 
                    };
                    const updated = await window.electronAPI.saveTag(tagData);
                    setTags(updated);
                    return tagData;
                  }}
                  onEdit={async (commentId, newTitle, newText) => {
                    const updated = await window.electronAPI.saveComment(selectedWorkoutId, { id: commentId, title: newTitle, text: newText });
                    setComments(updated);
                  }}
                  onDelete={async (commentId) => {
                    const updated = await window.electronAPI.deleteComment(selectedWorkoutId, commentId);
                    setComments(updated);
                  }}
                />
              </aside>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-clinical-secondary">
            Selecione um treino na lateral
          </div>
        )}
      </main>
    </div>
  );
}

function HeaderStat({ label, value }) {
  return (
    <div className="text-right">
      <p className="text-[10px] text-clinical-secondary font-bold uppercase tracking-wider">{label}</p>
      <p className="font-mono font-black text-sm text-clinical-text">{value}</p>
    </div>
  );
}

export default App;
