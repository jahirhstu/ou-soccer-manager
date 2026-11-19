import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/actions/communications',()=>({communicationsData:vi.fn(),communicationsStatus:vi.fn(),communicationsMutation:vi.fn()}));
import { Communications } from '../../components/Communications';
const connection={worker_mode:'idle',adaptive_coordination:true,state:'idle',compatible:true,automatic_enabled:true,heartbeat_interval_seconds:3600,heartbeat_at:new Date().toISOString(),lease_until:new Date(Date.now()+3900000).toISOString(),next_check_at:new Date(Date.now()+3600000).toISOString(),configuration_revision:'2',acknowledged_configuration_revision:'1'};
function render(overrides:Record<string,unknown>={}){
  return renderToStaticMarkup(<Communications initial={{templates:[],schedules:[],destinations:[],executions:[],organizationId:'org',alerts:null,alertSender:{senderConfigured:false,monitorConfigured:false},connection:{...connection,...overrides}}}/>);
}
it('explains intentional idle status, pending changes, and the local restart command',()=>{
  const html=render();expect(html).toContain('Idle');expect(html).toContain('saved login retained');expect(html).toContain('awaiting worker synchronization');expect(html).toContain('whatsapp restart');expect(html).toContain('30-minute active window');
});
it('marks an idle worker overdue after its expected check-in grace',()=>{
  expect(render({next_check_at:new Date(Date.now()-360000).toISOString()})).toContain('Check-in overdue');
});
it('removes the pending warning once accepted and supports older workers',()=>{
  expect(render({acknowledged_configuration_revision:'2'})).not.toContain('awaiting worker synchronization');
  const legacy=render({adaptive_coordination:false,worker_mode:'active',state:'ready',heartbeat_interval_seconds:30});
  expect(legacy).toContain('Active');expect(legacy).not.toContain('awaiting worker synchronization');
});

import { WorkerEmailAlerts,type WorkerAlertData } from '../../components/WorkerEmailAlerts';
const alertSettings:WorkerAlertData={settings:{recipient:'admin@example.com',enabled:false,test_succeeded_at:null},open_incidents:[],deliveries:[]};
it('requires sender setup and a successful test before offering alert activation',()=>{
  const html=renderToStaticMarkup(<WorkerEmailAlerts alerts={alertSettings} sender={{senderConfigured:false,monitorConfigured:false}} pending={false} onMutate={()=>{}}/>);
  expect(html).toContain('admin@example.com');expect(html).toContain('Setup required');expect(html).toContain('disabled="">Send test email');expect(html).toContain('disabled="">Enable alerts');
});
it('shows accepted test delivery, current incidents, and email failures to the admin',()=>{
  const html=renderToStaticMarkup(<WorkerEmailAlerts alerts={{...alertSettings,settings:{...alertSettings.settings!,test_succeeded_at:new Date().toISOString()},open_incidents:[{category:'connection',execution_id:null,opened_at:new Date().toISOString()}],deliveries:[{id:'delivery',kind:'failure',status:'failed',created_at:new Date().toISOString(),error_code:'provider_http_403'}]}} sender={{senderConfigured:true,monitorConfigured:true}} pending={false} onMutate={()=>{}}/>);
  expect(html).toContain('Open issue: connection');expect(html).toContain('provider_http_403');expect(html).not.toContain('disabled="">Enable alerts');
});
