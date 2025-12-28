import { Mail, ExternalLink } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
interface SupplierData {
  name: string;
  partDescription?: string;
  lastPurchased: string;
  price: string | number;
  email: string;
  rating?: number;
}
interface SupplierTableProps {
  suppliers: SupplierData[];
}
export function SupplierTable({ suppliers }: SupplierTableProps) {
  if (!suppliers?.length) return null;
  const formatPrice = (price: string | number) => {
    if (typeof price === 'number') {
      return price.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    }
    return price.includes('$') ? price : `$${price}`;
  };
  return (
    <div className="rounded-xl border bg-card overflow-hidden my-6 shadow-sm ring-1 ring-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50 border-b">
            <TableHead className="font-bold text-foreground h-10 px-4">Supplier</TableHead>
            <TableHead className="hidden md:table-cell font-bold text-foreground h-10 px-4">Contact Info</TableHead>
            <TableHead className="font-bold text-foreground h-10 px-4 text-center">Unit Price</TableHead>
            <TableHead className="text-right font-bold text-foreground h-10 px-4">Latest Order</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {suppliers.map((s, i) => (
            <TableRow key={i} className="group hover:bg-muted/30 transition-colors border-b last:border-0">
              <TableCell className="px-4 py-3">
                <div className="font-semibold text-foreground text-sm">{s.name}</div>
                {s.partDescription && (
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[180px]">
                    {s.partDescription}
                  </div>
                )}
                <div className="md:hidden flex items-center gap-1.5 mt-2">
                   <a 
                    href={`mailto:${s.email}`} 
                    className="text-[11px] inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Mail className="w-3 h-3" /> {s.email}
                  </a>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">{s.email}</span>
                  <Button variant="ghost" size="icon" asChild className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a href={`mailto:${s.email}`} title="Email Supplier">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </Button>
                </div>
              </TableCell>
              <TableCell className="px-4 py-3 text-center">
                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 font-mono text-xs border-emerald-100 dark:border-emerald-900">
                  {formatPrice(s.price)}
                </Badge>
              </TableCell>
              <TableCell className="text-right px-4 py-3">
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[11px] font-medium text-foreground">
                    {s.lastPurchased}
                  </span>
                  <Badge variant="outline" className="text-[9px] py-0 h-4 font-normal bg-background/50 uppercase tracking-tighter">
                    Historical
                  </Badge>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}