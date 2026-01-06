import pandas as pd
import os

file_path = r'c:\Users\sk873\Desktop\Projects\Queue Tracker\src\assets\QH.xlsx'

if not os.path.exists(file_path):
    print(f"Error: File not found at {file_path}")
else:
    try:
        # Read the sheet, skipping the first 4 rows
        df = pd.read_excel(file_path, skiprows=4)
        
        # The first row (index 0) contains the dates starting from column 3
        dates = df.iloc[0, 3:].tolist()
        # The second row (index 1) contains the days of the week starting from column 3
        days = df.iloc[1, 3:].tolist()
        
        print("--- Dates and Days ---")
        for date, day in zip(dates, days):
            print(f"{date} ({day})")
        
        # The actual agent data starts from row 2
        # Column 2 (index 2) is the Name column
        agent_data = df.iloc[2:].copy()
        agent_data = agent_data.dropna(subset=[df.columns[2]]) # Drop rows where name is NaN
        
        print("\n--- Agent Roster ---")
        # Select Name column and the date columns
        agent_data = agent_data.iloc[:, 2:]
        
        # Rename columns for clarity in output
        cols = ['Name'] + dates
        agent_data.columns = cols
        
        print(agent_data.head(15).to_string(index=False))
        
    except Exception as e:
        print(f"An error occurred: {e}")
        import traceback
        traceback.print_exc()
        
        print("\n--- Summary Statistics ---")
        print(df.describe(include='all').to_string())
        
    except Exception as e:
        print(f"An error occurred: {e}")
