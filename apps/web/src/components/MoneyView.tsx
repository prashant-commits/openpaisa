import type { AuditReport } from '@openpaisa/engine';
import { Tabs } from './Tabs';
import { SpendsTab } from './SpendsTab';
import { RecurringTab } from './RecurringTab';
import { LoansTab } from './LoansTab';
import { CardsTab } from './CardsTab';
import { UpcomingTab } from './UpcomingTab';

export function MoneyView({ report }: { report: AuditReport }) {
  return (
    <section aria-labelledby="mv-h">
      <h2 id="mv-h">Your money</h2>
      <Tabs label="Money view" tabs={[
        { id: 'spends', label: 'Spends', content: <SpendsTab report={report} /> },
        { id: 'recurring', label: 'Recurring', content: <RecurringTab report={report} /> },
        { id: 'loans', label: 'Loans & EMIs', content: <LoansTab report={report} /> },
        { id: 'cards', label: 'Cards', content: <CardsTab report={report} /> },
        { id: 'upcoming', label: 'Upcoming', content: <UpcomingTab report={report} /> },
      ]} />
    </section>
  );
}
