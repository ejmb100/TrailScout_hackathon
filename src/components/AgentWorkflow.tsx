import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain,
  Search,
  ShieldCheck,
  Zap,
  CheckCircle2,
  Loader2,
  ArrowDown,
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
      className="w-full max-w-2xl mx-auto"
    >
      {/* Header */}
      <div className="text-center mb-8">
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
      </div>

      {/* Agent Steps */}
      <div className="space-y-3">
        {agents.map((agent, index) => {
          const status = getAgentStatus(agent.id, currentStage);
          const Icon = agent.icon;
          const summary = getSummaryForAgent(agent.id, props);

          return (
            <React.Fragment key={agent.id}>
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1, duration: 0.4 }}
                className={`relative rounded-2xl overflow-hidden transition-all duration-500 ${
                  status === 'active' 
                    ? 'ring-2 shadow-lg' 
                    : status === 'done'
                    ? 'opacity-90'
                    : 'opacity-40'
                }`}
                style={{
                  ringColor: status === 'active' ? agent.color : 'transparent',
                  boxShadow: status === 'active' ? `0 0 30px ${agent.bgGlow}` : 'none',
                }}
              >
                {/* Active shimmer effect */}
                {status === 'active' && (
                  <motion.div
                    className="absolute inset-0 shimmer rounded-2xl"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  />
                )}

                <div 
                  className="relative glass-bright rounded-2xl p-4 flex items-start gap-4"
                  style={{
                    borderColor: status === 'active' ? `${agent.color}40` : 'rgba(255,255,255,0.06)',
                    borderWidth: '1px',
                    borderStyle: 'solid',
                  }}
                >
                  {/* Icon */}
                  <div
                    className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ 
                      backgroundColor: status !== 'pending' ? `${agent.color}20` : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    {status === 'active' ? (
                      <Loader2 
                        className="w-5 h-5 animate-spin" 
                        style={{ color: agent.color }}
                      />
                    ) : status === 'done' ? (
                      <CheckCircle2 
                        className="w-5 h-5" 
                        style={{ color: agent.color }}
                      />
                    ) : (
                      <Icon 
                        className="w-5 h-5" 
                        style={{ color: 'rgba(255,255,255,0.3)' }}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h4 
                        className="font-display font-bold text-sm"
                        style={{ color: status !== 'pending' ? agent.color : 'rgba(255,255,255,0.3)' }}
                      >
                        {agent.name}
                      </h4>
                      <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
                        status === 'active' 
                          ? 'bg-white/10 text-white' 
                          : status === 'done'
                          ? 'bg-green/10 text-green'
                          : 'bg-white/5 text-white/20'
                      }`}>
                        {status === 'active' ? 'Running' : status === 'done' ? 'Done' : 'Queued'}
                      </span>
                    </div>
                    
                    <p className="text-xs text-offwhite/50 leading-relaxed">
                      {status === 'done' 
                        ? agent.doneDescription
                        : status === 'active'
                        ? agent.description
                        : `Waiting for ${agents[index - 1]?.name || 'start'}...`
                      }
                    </p>

                    {/* Summary when done */}
                    <AnimatePresence>
                      {status === 'done' && summary && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mt-2 text-xs text-offwhite/70 italic border-l-2 pl-3 py-1"
                          style={{ borderColor: `${agent.color}60` }}
                        >
                          "{summary}"
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.div>

              {/* Connector arrow */}
              {index < agents.length - 1 && (
                <div className="flex justify-center">
                  <ArrowDown 
                    className={`w-4 h-4 transition-colors duration-300 ${
                      getAgentStatus(agents[index + 1].id, currentStage) !== 'pending'
                        ? 'text-white/30'
                        : 'text-white/10'
                    }`}
                  />
                </div>
              )}
            </React.Fragment>
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
