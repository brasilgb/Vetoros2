INSERT INTO system_role_templates (code,name,scope_type,inherits_descendants) VALUES
  ('owner','Owner','tenant',true), ('administrator','Administrator','tenant',true), ('attendance','Attendance','branch',false),
  ('technician','Technician','branch',false), ('inventory','Inventory','branch',false), ('cashier','Cashier','branch',false),
  ('finance','Finance','company',false), ('fiscal','Fiscal','company',false), ('read_only','Read only','tenant',true)
ON CONFLICT (code) DO NOTHING;
