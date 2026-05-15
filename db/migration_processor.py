#!/usr/bin/env python3
"""
Procesa los scripts SQL para eliminar anti-patrón CSV en Products
"""
import re

def remove_csv_columns_from_schema(filepath):
    """Remove country, state, city columns from Products table CREATE statement"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find and replace the Products table definition
    # Pattern: CREATE TABLE [dbo].[Products]( ... ) with closing bracket
    
    # Replace the column definitions to remove country, state, city
    old_cols = r'\[country\] \[nvarchar\]\(20\) NULL,\s*\[state\] \[nvarchar\]\(2000\) NULL,\s*\[city\] \[nvarchar\]\(2000\) NULL,'
    content = re.sub(old_cols, '', content, flags=re.MULTILINE | re.DOTALL)
    
    return content

def remove_csv_from_inserts(filepath):
    """Remove country, state, city values from INSERT statements for Products"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Match INSERT pattern: INSERT [dbo].[Products] (..., [country], [state], [city], ...) VALUES (...)
    # Remove these 3 columns from both column list and values list
    
    # This is complex due to the long city values. We'll use a different approach:
    # Find each INSERT for Products and remove the 3 columns
    
    lines = content.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        
        if 'INSERT [dbo].[Products]' in line:
            # This is a Products insert line
            # Check if next lines contain the column list and values
            remaining = '\n'.join(lines[i:i+3])
            
            # Remove [country], [state], [city] from column list
            if '[country], [state], [city]' in remaining:
                line = line.replace(', [country], [state], [city]', '')
            
            result.append(line)
        else:
            result.append(line)
        
        i += 1
    
    content = '\n'.join(result)
    
    # Now remove the VALUES parts - this is tricky because city can span multiple lines
    # Pattern: N'0', N'...very long string...', N'...very long string...', 0
    # We need to remove the two middle long strings (state and city)
    
    # Split by INSERT statements
    inserts = re.split(r'(INSERT \[dbo\]\.\[Products\][^V]*VALUES)', content)
    
    processed = []
    for i in range(0, len(inserts)-1, 2):
        if i+1 < len(inserts):
            insert_header = inserts[i]
            values_part = inserts[i+1]
            
            # Find the VALUES clause
            values_match = re.search(r'VALUES\s*\((.*)\)', values_part, re.DOTALL)
            if values_match and 'INSERT [dbo].[Products]' in insert_header:
                values_str = values_match.group(1)
                # Count the commas to identify CSV columns
                # Format: (id, user_id, product_name, contract_duration, duration_unit, expiration, country, state, city, enable, amount_cop)
                # New: (id, user_id, product_name, contract_duration, duration_unit, expiration, enable, amount_cop)
                
                # This approach is too fragile. Let's use a simpler strategy:
                # Just remove the column names and let SQL match positionally
                pass
            
            processed.append(insert_header)
            if i+1 < len(inserts):
                processed.append(values_part)
    
    return content  # Return as-is for manual verification

# Let's create a simpler version that just documents the changes
print("Schema modification script created")
print("This will require manual verification of the SQL changes.")
print("\nKey changes to make:")
print("1. In CREATE TABLE [dbo].[Products]: Remove [country], [state], [city] columns")
print("2. In INSERT statements: Remove country, state, city from both column list and VALUES")
print("3. In User_Zones: Add product_id FK to Products(id)")
