import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain,
  Search,
  ShieldCheck,
  Zap,
  CheckCircle2,
  Loader2,
} from 'lucide-react';

export type AgentStage = 'idle' | 'intent' | 'research' | 'validation' | 'action' | 'complete';

interface AgentWorkflowProps {
  currentStage: AgentStage;
  intentSummary?: string;
  researchSummary?: string;
  validationSummary?: string;
  actionSummary?: string;
}

const agents = [
  {
    id: 'intent' as const,
    name: 'Intent Agent',
    description: 'Parsing your natural language into structured preferences...',
    doneDescription: 'Extracted location, difficulty, distance, scenery preferences, and constraints.',
    icon: Brain,
    color: '#A78BFA', // purple
    bgGlow: 'rgba(167, 139, 250, 0.15)',
  },
  {
    id: 'research' as const,
    name: 'Research Agent',
    description: 'Gathering trail data, weather, drive times, and crowd estimates...',
    doneDescription: 'Found and ranked candidate trails with supporting evidence.',
    icon: Search,
    color: '#60A5FA', // blue
    bgGlow: 'rgba(96, 165, 250, 0.15)',
  },
  {
    id: 'validation' as const,
    name: 'Validation Agent',
    description: 'Checking each trail against your constraints and flagging risks...',
    doneDescription: 'Validated trails for fit, flagged warnings, and scored confidence.',
    icon: ShieldCheck,
    color: '#03D4BD', // teal
    bgGlow: 'rgba(3, 212, 189, 0.15)',
  },
  {
    id: 'action' as const,
    name: 'Action Agent',
    description: 'Building your trip plan with departure time, gear list, and backup...',
    doneDescription: 'Your personalized trip plan is ready.',
    icon: Zap,
    color: '#FF7D0F', // orange
    bgGlow: 'rgba(255, 125, 15, 0.15)',
  },
];

const stageOrder: AgentStage[] = ['intent', 'research', 'validation', 'action'];

function getAgentStatus(agentId: string, currentStage: AgentStage): 'pending' | 'active' | 'done' {
  const currentIndex = stageOrder.indexOf(currentStage as any);
  const agentIndex = stageOrder.indexOf(agentId as any);

  if (currentStage === 'complete') return 'done';
  if (currentStage === 'idle') return 'pending';
  if (agentIndex < currentIndex) return 'done';
  if (agentIndex === currentIndex) return 'active';
  return 'pending';
}

function getSummaryForAgent(
  agentId: string,
  props: AgentWorkflowProps
): string | undefined {
  switch (agentId) {
    case 'intent': return props.intentSummary;
    case 'research': return props.researchSummary;
    case 'validation': return props.validationSummary;
    case 'action': return props.actionSummary;
    default: return undefined;
  }
}

const AgentWorkflow: React.FC<AgentWorkflowProps> = (props) => {
  const { currentStage } = props;

  if (currentStage === 'idle') return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-7xl mx-auto"
    >
      {/* Header */}
      <div className="text-center mb-6">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center gap-2 bg-white/5 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 mb-4"
        >
          <span className="w-2 h-2 rounded-full bg-teal animate-pulse" />
          <span className="text-xs font-semibold text-teal uppercase tracking-wider">
            Multi-Agent Pipeline Active
          </span>
        </motion.div>
        <h3 className="font-display text-2xl font-bold text-offwhite">
          {currentStage === 'complete' ? 'Analysis Complete' : 'Agents Working...'}
        </h3>
        <p className="text-offwhite/35 text-xs mt-2 max-w-xl mx-auto">
          Four stages shown side by side — the pipeline still runs in order under the hood.
        </p>
      </div>

      {/* Agent columns */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {agents.map((agent, index) => {
          const status = getAgentStatus(agent.id, currentStage);
          const Icon = agent.icon;
          const summary = getSummaryForAgent(agent.id, props);

          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.08, duration: 0.4 }}
              className={`relative rounded-xl overflow-hidden transition-all duration-500 min-h-[180px] flex flex-col ${
                status === 'active'
                  ? 'shadow-lg'
                  : status === 'done'
                  ? 'opacity-95'
                  : 'opacity-45'
              }`}
              style={{
                boxShadow: status === 'active' ? `0 0 28px ${agent.bgGlow}` : undefined,
              }}
            >
              {status === 'active' && (
                <motion.div
                  className="absolute inset-0 shimmer rounded-xl pointer-events-none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                />
              )}

              <div
                className="relative glass-bright rounded-xl p-3 sm:p-3.5 flex flex-col items-center text-center h-full min-h-[180px]"
                style={{
                  borderColor: status === 'active' ? `${agent.color}55` : 'rgba(255,255,255,0.06)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  ...(status === 'active' ? { outline: `2px solid ${agent.color}`, outlineOffset: '0px' } : {}),
                }}
              >
                <div
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center mb-2"
                  style={{
                    backgroundColor: status !== 'pending' ? `${agent.color}22` : 'rgba(255,255,255,0.05)',
                  }}
                >
                  {status === 'active' ? (
                    <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" style={{ color: agent.color }} />
                  ) : status === 'done' ? (
                    <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: agent.color }} />
                  ) : (
                    <Icon className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: 'rgba(255,255,255,0.28)' }} />
                  )}
                </div>

                <h4
                  className="font-display font-bold text-[10px] sm:text-xs leading-tight mb-1"
                  style={{ color: status !== 'pending' ? agent.color : 'rgba(255,255,255,0.3)' }}
                >
                  {agent.name}
                </h4>

                <span
                  className={`text-[8px] sm:text-[9px] uppercase tracking-wide font-bold px-1.5 sm:px-2 py-0.5 rounded-full mb-2 ${
                    status === 'active'
                      ? 'bg-white/10 text-white'
                      : status === 'done'
                      ? 'bg-green/10 text-green'
                      : 'bg-white/5 text-white/20'
                  }`}
                >
                  {status === 'active' ? 'Running' : status === 'done' ? 'Done' : 'Queued'}
                </span>

                <p className="text-[9px] sm:text-[11px] text-offwhite/50 leading-snug flex-1 line-clamp-4">
                  {status === 'done'
                    ? agent.doneDescription
                    : status === 'active'
                    ? agent.description
                    : `Waiting for ${agents[index - 1]?.name || 'start'}...`}
                </p>

                <AnimatePresence>
                  {status === 'done' && summary && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 text-[9px] sm:text-[11px] text-offwhite/65 italic border-t border-white/10 pt-2 w-full line-clamp-3"
                    >
                      &ldquo;{summary}&rdquo;
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Complete indicator */}
      <AnimatePresence>
        {currentStage === 'complete' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 text-center"
          >
            <div className="inline-flex items-center gap-2 gradient-teal text-navy px-6 py-3 rounded-full font-bold text-sm shadow-lg">
              <CheckCircle2 className="w-4 h-4" />
              All agents complete — Scroll to view results
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default AgentWorkflow;
